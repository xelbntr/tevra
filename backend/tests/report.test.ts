import assert from 'node:assert/strict'
import { before, after, beforeEach, test } from 'node:test'
import type { ReportData } from '../src/reports/data.js'
import express from 'express'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import PizZip from 'pizzip'

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const studentId = uuid(1)
const classId = uuid(2)
const enrollmentId = uuid(3)
const lecturerId = uuid(4)
const accessToken = 'test-access-token'

const enrollment = {
  id: enrollmentId, status: 'active',
  student: { id: studentId, student_number: '2026001', full_name: 'Test Student' },
  class: { id: classId, name: 'Mathematics A', course_code: 'MATH101', academic_year: '2026/2027', semester: '1' },
}
const attendanceRow = (status: ReportData['attendance'][number]['status'], index = 1): ReportData['attendance'][number] => ({
  id: uuid(100 + index), attendance_date: new Date(Date.UTC(2023, 0, index)).toISOString().slice(0, 10), status, notes: null,
})
const gradeRow = (score: number, maxScore = 100, index = 1): ReportData['grades'][number] => ({
  id: uuid(200 + index), score, feedback: null, graded_at: '2026-10-16T08:00:00+00:00',
  assessment: {
    id: uuid(300 + index), title: `Quiz ${index}`, assessment_type: 'quiz',
    max_score: maxScore, weight: null, due_date: '2026-10-15',
  },
})
const narrative = {
  title: 'Student report draft',
  academic_summary: 'Recorded assessment scores are available for teacher review.',
  attendance_summary: 'Recorded attendance includes present and late entries.',
  strengths: [], areas_for_support: [], recommended_next_steps: [],
  data_limitations: ['A complete course grading policy has not been supplied.'],
}

let attendanceRows: ReturnType<typeof attendanceRow>[]
let gradeRows: ReturnType<typeof gradeRow>[]
let visible: boolean
let authenticated: boolean
let databaseError: boolean
let pageCap: number
let missingCount: boolean
let aiContent: string | null
let finishReason: string
let requests: { url: URL, authorization: string | undefined, body: any }[]

// An in-memory HTTP fixture exercises the real Supabase and Groq clients
// without reading real records, using sockets, or making paid model requests.
const originalFetch = globalThis.fetch
const mockFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const body = await request.text()
  requests.push({ url, authorization: request.headers.get('authorization') ?? undefined, body: body ? JSON.parse(body) : null })
  const reply = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  })

  if (url.pathname === '/auth/v1/user') {
    return reply(authenticated ? { id: lecturerId } : { message: 'Invalid session' }, authenticated ? 200 : 401)
  }
  if (url.pathname === '/rest/v1/enrollments') {
    return reply(visible ? [enrollment] : [])
  }
  if (url.pathname === '/rest/v1/attendance' || url.pathname === '/rest/v1/grades') {
    if (databaseError) {
      return reply({ code: '42501', message: 'Permission denied' }, 403)
    }
    const rows = url.pathname.endsWith('/attendance') ? attendanceRows : gradeRows
    const cursor = url.searchParams.get('id')?.replace(/^gt\./, '')
    const remaining = rows.filter(row => !cursor || row.id > cursor).sort((a, b) => a.id.localeCompare(b.id))
    const page = remaining.slice(0, Math.min(pageCap, Number(url.searchParams.get('limit'))))
    return reply(page, 200, missingCount ? {} : {
      'Content-Range': `0-${Math.max(0, page.length - 1)}/${remaining.length}`,
    })
  }
  if (url.pathname === '/openai/v1/chat/completions') {
    return reply({
      id: 'test-completion', object: 'chat.completion',
      choices: [{ finish_reason: finishReason, message: { role: 'assistant', content: aiContent } }],
    })
  }
  throw new Error(`Unexpected test request: ${url}`)
}

let generateReport: typeof import('../src/reports/report.js').generateReport
let buildStudentReport: typeof import('../src/reports/report.js').buildStudentReport
let AuthenticationError: typeof import('../src/auth.js').AuthenticationError
let renderReportDocument: typeof import('../src/reports/document.js').renderReportDocument
let reportServer: ReturnType<express.Express['listen']>
let reportUrl: string

before(async () => {
  globalThis.fetch = mockFetch
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.GROQ_BASE_URL = 'https://groq.test'
  process.env.AI_API_KEY = 'test-ai-key'
  ;({ AuthenticationError } = await import('../src/auth.js'))
  ;({ generateReport, buildStudentReport } = await import('../src/reports/report.js'))
  ;({ renderReportDocument } = await import('../src/reports/document.js'))
  const { reportsRouter } = await import('../src/reports/router.js')
  const app = express()
  app.use(express.json())
  app.use('/api/reports', reportsRouter)
  reportServer = app.listen(0, '127.0.0.1')
  await once(reportServer, 'listening')
  const address = reportServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  reportUrl = `http://127.0.0.1:${address.port}/api/reports`
})

after(async () => {
  globalThis.fetch = originalFetch
  if (reportServer) {
    const closed = once(reportServer, 'close')
    reportServer.close()
    reportServer.closeAllConnections()
    await closed
  }
})

beforeEach(() => {
  attendanceRows = [attendanceRow('present'), attendanceRow('late', 2), attendanceRow('absent', 3), attendanceRow('excused', 4)]
  gradeRows = [gradeRow(40, 50), gradeRow(9, 10, 2)]
  visible = true
  authenticated = true
  databaseError = false
  pageCap = 500
  missingCount = false
  aiContent = JSON.stringify(narrative)
  finishReason = 'stop'
  requests = []
})

const runReport = () => generateReport(accessToken, { student_id: studentId, class_id: classId })
const aiRequests = () => requests.filter(r => r.url.pathname === '/openai/v1/chat/completions')

const requestReport = (path = '', body: unknown = { class_id: classId, student_id: studentId }, token: string | null = accessToken) => originalFetch(`${reportUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
})

test('HTTP preview returns the existing report contract with private cache headers', async () => {
  const response = await requestReport()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const report = await response.json()
  assert.equal(report.grade, 85)
  assert.equal(report.attendance, 50)
  assert.equal(report.report.title, narrative.title)
  assert.equal(aiRequests().length, 1)
})

test('both HTTP endpoints validate authentication, selections, and enrollment access', async () => {
  for (const path of ['', '/download']) {
    assert.equal((await requestReport(path, {}, null)).status, 401)
    assert.equal((await requestReport(path, { class_id: 'invalid', student_id: studentId })).status, 400)
    authenticated = false
    assert.equal((await requestReport(path)).status, 401)
    authenticated = true
    visible = false
    const response = await requestReport(path)
    assert.equal(response.status, 404)
    assert.equal((await response.json()).code, 'ENROLLMENT_NOT_FOUND')
    visible = true
  }
  assert.equal(aiRequests().length, 0)
})

test('both HTTP endpoints return JSON errors for database and AI failures', async () => {
  for (const path of ['', '/download']) {
    databaseError = true
    let response = await requestReport(path)
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match((await response.json()).error, /Could not generate/)
    databaseError = false
    aiContent = 'not JSON'
    response = await requestReport(path)
    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /Could not generate/)
    aiContent = JSON.stringify(narrative)
  }
})

test('HTTP download returns a valid populated Word attachment and reads records once', async () => {
  const response = await requestReport('/download')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type')!, /wordprocessingml.document/)
  assert.match(response.headers.get('content-disposition')!, new RegExp(`${studentId}_${classId}\\.docx`))
  assert.equal(response.headers.get('access-control-expose-headers'), 'Content-Disposition')
  const zip = new PizZip(Buffer.from(await response.arrayBuffer()))
  const xml = zip.file('word/document.xml')!.asText()
  assert.ok(xml.includes('Test Student'))
  assert.ok(xml.includes('2026001'))
  assert.ok(xml.includes('85.00%'))
  assert.ok(xml.includes('50.00%'))
  assert.ok(xml.includes('Draf AI'))
  assert.ok(!xml.includes('{{'))
  assert.ok(!xml.includes('20%'))
  assert.ok(!xml.includes('[LOGO SEKOLAH]'))
  assert.equal(requests.filter(r => r.url.pathname === '/rest/v1/enrollments').length, 1)
  assert.equal(aiRequests().length, 1)
})

test('template rendering preserves source parts, escapes text, and distinguishes zero from no data', async () => {
  const source = readFileSync(new URL('../../docs/Template_Penilaian_Satu_Siswa_SMA_JOINTS.docx', import.meta.url))
  const { jointsTemplateBase64, jointsTemplateSha256 } = await import('../src/reports/template.js')
  assert.equal(createHash('sha256').update(source).digest('hex'), jointsTemplateSha256)
  assert.deepEqual(Buffer.from(jointsTemplateBase64, 'base64'), source)
  const records = {
    ...enrollment, student: { ...enrollment.student, full_name: 'A & B <Student>' },
    attendance: [attendanceRow('late')], grades: [gradeRow(0)],
  }
  const result = await buildStudentReport(records)
  const document = renderReportDocument(records, result, new Date('2026-10-16T00:00:00Z'))
  const zip = new PizZip(document)
  const original = new PizZip(source)
  const parts = Object.values(original.files).filter(file => !file.dir).map(file => file.name).sort()
  assert.deepEqual(Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort(), parts)
  for (const path of parts.filter(path => path !== 'word/document.xml')) {
    assert.deepEqual(zip.file(path)!.asUint8Array(), original.file(path)!.asUint8Array(), path)
  }
  const xml = zip.file('word/document.xml')!.asText()
  assert.ok(xml.includes('A &amp; B &lt;Student&gt;'))
  assert.ok(xml.includes('0.00%'))
  assert.ok(xml.includes('100.00%'))
  assert.ok(xml.includes('16 Oktober 2026'))
  assert.ok(xml.includes('N/A'))
  assert.ok(xml.includes('—'))
  assert.ok(!xml.includes('{{'))
  const empty = { ...records, attendance: [], grades: [] }
  const emptyResult = await buildStudentReport(empty)
  const emptyXml = new PizZip(renderReportDocument(empty, emptyResult)).file('word/document.xml')!.asText()
  assert.ok(!emptyXml.includes('0.00%'))
  assert.ok(emptyXml.includes('Belum tercatat'))
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../docs/Template_Penilaian_Satu_Siswa_SMA_JOINTS.docx', import.meta.url))).digest('hex'), jointsTemplateSha256)
})

test('returns validated report and exact normalized percentages; sends only queried JSON', async () => {
  const result = await runReport()
  assert.ok(result)
  assert.equal(result.grade, 85) // mean(40/50, 9/10), not mean(40, 9)
  assert.equal(result.attendance, 50) // present + late, including excused in total
  assert.deepEqual(result.report.attendance_totals, { total: 4, present: 1, late: 1, absent: 1, excused: 1 })
  assert.deepEqual(result.report.grade_summary, {
    graded_assessments: 2, average_percentage: 85, basis: 'unweighted_assessment_percentages',
  })
  assert.equal(result.report.title, narrative.title)
  const [request] = aiRequests()
  assert.equal(aiRequests().length, 1)
  assert.equal(request.body.messages.length, 2)
  assert.equal(request.body.messages[0].role, 'system')
  assert.equal(request.body.messages[1].role, 'user')
  assert.deepEqual(JSON.parse(request.body.messages[1].content), {
    ...enrollment, attendance: attendanceRows, grades: gradeRows,
  })
  assert.equal(request.body.response_format.type, 'json_schema')
  assert.equal(request.body.response_format.json_schema.strict, true)
  const schema = request.body.response_format.json_schema.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, Object.keys(narrative))
  const databaseRequests = requests.filter(r => r.url.pathname.startsWith('/rest/'))
  assert.ok(databaseRequests.every(r => r.authorization === `Bearer ${accessToken}`))
  assert.equal(databaseRequests[0].url.searchParams.get('student_id'), `eq.${studentId}`)
  assert.equal(databaseRequests[0].url.searchParams.get('class_id'), `eq.${classId}`)
  assert.ok(databaseRequests.slice(1).every(r => r.url.searchParams.get('enrollment_id') === `eq.${enrollmentId}`))
})

test('returns null for no visible enrollment and skips history and AI requests', async () => {
  visible = false
  assert.equal(await runReport(), null)
  assert.equal(requests.length, 2) // authenticate and lookup only
  assert.equal(aiRequests().length, 0)
})

test('returns null averages and a factual draft without AI when no records exist', async () => {
  attendanceRows = []
  gradeRows = []
  const result = await runReport()
  assert.ok(result)
  assert.equal(result.grade, null)
  assert.equal(result.attendance, null)
  assert.equal(result.report.attendance_totals.total, 0)
  assert.ok(result.report.data_limitations.length)
  assert.equal(aiRequests().length, 0)
})

test('distinguishes missing grades from a real zero score and rounds rates', async () => {
  attendanceRows = [attendanceRow('present'), attendanceRow('absent', 2), attendanceRow('excused', 3)]
  gradeRows = []
  const missing = await runReport()
  assert.equal(missing?.grade, null)
  assert.equal(missing?.attendance, 33.33)
  gradeRows = [gradeRow(0)]
  attendanceRows = []
  const zero = await runReport()
  assert.equal(zero?.grade, 0)
  assert.equal(zero?.attendance, null)
})

test('uses recorded assessment percentages rather than incomplete weights', async () => {
  gradeRows = [gradeRow(1, 3), gradeRow(1, 2, 2)]
  gradeRows[0]!.assessment.weight = 10
  gradeRows[1]!.assessment.weight = 90
  const result = await runReport()
  assert.equal(result?.grade, 41.67)
})

test('loads all rows when a server cap is lower than requested, for both histories', async () => {
  pageCap = 1
  const result = await runReport()
  assert.equal(result?.grade, 85)
  assert.equal(result?.report.attendance_totals.total, 4)
  assert.equal(aiRequests().length, 1)
  const history = requests.filter(r => ['/rest/v1/attendance', '/rest/v1/grades'].includes(r.url.pathname))
  assert.equal(history.length, 6)
  assert.ok(history.slice(2).some(r => r.url.searchParams.has('id')))
})

test('preserves actual zero attendance and recorded extra-credit grades', async () => {
  attendanceRows = [attendanceRow('absent'), attendanceRow('excused', 2)]
  gradeRows = [gradeRow(55, 50)]
  const result = await runReport()
  assert.equal(result?.attendance, 0)
  assert.equal(result?.grade, 110)
})

test('loads more than the default 1000-record cap without truncating totals', async () => {
  attendanceRows = Array.from({ length: 1001 }, (_, i) => attendanceRow(i === 1000 ? 'absent' : 'present', i + 1))
  const result = await runReport()
  assert.equal(result?.attendance, 99.9)
  assert.equal(result?.report.attendance_totals.total, 1001)
  assert.equal(JSON.parse(aiRequests()[0]!.body.messages[1].content).attendance.length, 1001)
})

test('rejects invalid IDs before any requests and rejects invalid sessions', async () => {
  await assert.rejects(generateReport(accessToken, { class_id: 'invalid', student_id: studentId }))
  assert.equal(requests.length, 0)
  authenticated = false
  await assert.rejects(runReport(), AuthenticationError)
  assert.equal(aiRequests().length, 0)
})

test('propagates database errors and refuses unverifiable page completeness', async () => {
  databaseError = true
  await assert.rejects(runReport(), error => (error as { code: string }).code === '42501')
  assert.equal(aiRequests().length, 0)
  databaseError = false
  missingCount = true
  await assert.rejects(runReport(), /complete report records/)
  assert.equal(aiRequests().length, 0)
})

test('rejects invalid database scores, maxima, statuses and missing relationships before AI', async () => {
  for (const change of [
    (data: any) => { data.grades[0].score = NaN },
    (data: any) => { data.grades[0].score = -1 },
    (data: any) => { data.grades[0].score = Infinity },
    (data: any) => { data.grades[0].assessment.max_score = 0 },
    (data: any) => { data.grades[0].assessment = null },
    (data: any) => { data.attendance[0].status = 'unknown' },
    (data: any) => { data.student = null },
  ]) {
    const data = structuredClone({ ...enrollment, attendance: attendanceRows, grades: gradeRows })
    change(data)
    await assert.rejects(buildStudentReport(data))
  }
  assert.equal(aiRequests().length, 0)
})

test('rejects arithmetic overflow before contacting the model', async () => {
  const data = {
    ...enrollment, attendance: attendanceRows,
    grades: [gradeRow(Number.MAX_VALUE, Number.MIN_VALUE)],
  }
  await assert.rejects(buildStudentReport(data), /percentage is not finite/)
  assert.equal(aiRequests().length, 0)
})

test('rejects malformed JSON, missing fields, wrong types and unexpected output fields', async () => {
  for (const content of [
    'not JSON', '```json\n{}\n```', 'null', '[]', '{}',
    JSON.stringify({ ...narrative, title: ' ' }),
    JSON.stringify({ ...narrative, strengths: 'good work' }),
    JSON.stringify({ ...narrative, untrusted_extra: true }),
  ]) {
    aiContent = content
    await assert.rejects(runReport(), /JSON/)
  }
})

test('rejects empty or incomplete model output rather than returning a partial report', async () => {
  aiContent = null
  await assert.rejects(runReport(), /empty report/)
  aiContent = JSON.stringify(narrative)
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    finishReason = reason
    await assert.rejects(runReport(), /did not complete/)
  }
})
