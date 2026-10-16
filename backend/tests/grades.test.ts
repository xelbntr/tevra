import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { once } from 'node:events'
import express from 'express'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'grades-key', alg: 'ES256', use: 'sig' }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const classRow = { id: id(2), name: 'Math', course_code: 'M01', academic_year: '2026', semester: '1' }
const enrollment = { id: id(3), class_id: id(2), student: { id: id(4), full_name: 'Ada', student_number: 'S001' } }
const assessment = { id: id(5), class_id: id(2), title: 'Quiz 1', assessment_type: 'quiz', max_score: 50 }
const grade = { id: id(6), enrollment_id: id(3), assessment_id: id(5), score: 40 }
const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: jwk.kid })).toString('base64url')
const payload = Buffer.from(JSON.stringify({ sub: id(1), role: 'authenticated', aud: 'authenticated',
  iss: 'https://grades.supabase.test/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
const unsigned = `${header}.${payload}`
const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
const originalFetch = globalThis.fetch
let hidden = false, otherClass = false
let writes: { url: URL; body: Record<string, unknown>; authorization: string | null }[]
let reads: URL[]
let requestGrades: typeof import('../src/grade.js').requestGrades
let saveGrade: typeof import('../src/grade.js').saveGrade
let createAssessment: typeof import('../src/grade.js').createAssessment
let gradesRouter: typeof import('../src/grade.js').gradesRouter

before(async () => {
  process.env.SUPABASE_URL = 'https://grades.supabase.test'
  process.env.SUPABASE_ANON_KEY = 'test-key'
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] })
    if (url.pathname === '/auth/v1/user') return Response.json({ id: id(1) })
    if (request.method === 'POST') {
      const body = await request.json() as Record<string, unknown>
      writes.push({ url, body, authorization: request.headers.get('authorization') })
      return Response.json({ ...(url.pathname.endsWith('/grades') ? grade : assessment), ...body })
    }
    reads.push(url)
    let rows: { id: string }[] = []
    if (url.pathname.endsWith('/classes')) rows = hidden ? [] : [classRow]
    if (url.pathname.endsWith('/enrollments')) rows = hidden ? [] : [enrollment]
    if (url.pathname.endsWith('/assessments')) rows = [{ ...assessment, class_id: otherClass ? id(99) : id(2) }]
    if (url.pathname.endsWith('/grades')) rows = [grade, { ...grade, id: id(7), score: 0 }]
    const after = url.searchParams.get('id')?.replace(/^gt\./, '')
    if (after && url.searchParams.get('id')?.startsWith('gt.')) rows = rows.filter(row => row.id > after)
    // Simulate a server cap of one row, despite the requested 500-row page.
    return Response.json(rows.slice(0, 1), { headers: { 'Content-Range': `0-0/${rows.length}` } })
  }
  ;({ requestGrades, saveGrade, createAssessment, gradesRouter } = await import('../src/grade.js'))
})
beforeEach(() => { hidden = false; otherClass = false; writes = []; reads = [] })
after(() => { globalThis.fetch = originalFetch })

test('loads real identifiers and all grade pages, scoped to owned active enrollments', async () => {
  const result = await requestGrades(token)
  assert.equal(result.students[0]?.student_id, id(4))
  assert.equal(result.students[0]?.enrollment_id, id(3))
  assert.deepEqual(result.assessments, [assessment])
  assert.equal(result.grades.length, 2)
  assert.equal(result.grades[1]?.score, 0)
  assert.equal(reads.find(url => url.pathname.endsWith('/classes'))?.searchParams.get('lecturer_id'), `eq.${id(1)}`)
  assert.equal(reads.find(url => url.pathname.endsWith('/enrollments'))?.searchParams.get('status'), 'eq.active')
})

test('saves zero and decimal scores with the existing unique key and leaves feedback untouched', async () => {
  for (const score of [0, 37.5, 50]) {
    const saved = await saveGrade(token, { enrollment_id: id(3), assessment_id: id(5), score })
    assert.equal(saved.score, score)
    const write = writes.at(-1)!
    assert.equal(write.url.searchParams.get('on_conflict'), 'enrollment_id,assessment_id')
    assert.equal(write.authorization, `Bearer ${token}`)
    assert.equal('feedback' in write.body, false)
  }
})

test('rejects excessive scores, bad precision, inaccessible enrollments and mismatched classes before writing', async () => {
  for (const score of [-1, 50.01, 1.234, NaN]) {
    await assert.rejects(saveGrade(token, { enrollment_id: id(3), assessment_id: id(5), score }))
  }
  otherClass = true
  await assert.rejects(saveGrade(token, { enrollment_id: id(3), assessment_id: id(5), score: 25 }), /same available class/)
  otherClass = false
  hidden = true
  await assert.rejects(saveGrade(token, { enrollment_id: id(3), assessment_id: id(5), score: 25 }), /same available class/)
  assert.equal(writes.length, 0)
  assert.deepEqual(await requestGrades(token), { classes: [], students: [], assessments: [], grades: [] })
})

test('creates an assessment in the existing schema and rejects empty titles or invalid maxima', async () => {
  const input = { class_id: id(2), title: ' Final exam ', assessment_type: 'exam', max_score: 20 }
  const created = await createAssessment(token, input)
  assert.equal(created.title, 'Final exam')
  assert.equal(created.max_score, 20)
  for (const invalid of [{ ...input, title: ' ' }, { ...input, max_score: 0 }]) await assert.rejects(createAssessment(token, invalid))
  assert.equal(writes.length, 1)
})

test('HTTP gradebook and save routes authenticate, validate and return saved records', async t => {
  const app = express()
  app.use(express.json())
  app.use('/api/grades', gradesRouter)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.close(); server.closeAllConnections() })
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/api/grades`
  assert.equal((await originalFetch(url)).status, 401)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const loaded = await originalFetch(url, { headers })
  assert.equal(loaded.headers.get('cache-control'), 'no-store')
  assert.equal((await loaded.json()).grades.length, 2)
  const saved = await originalFetch(url, { method: 'POST', headers,
    body: JSON.stringify({ enrollment_id: id(3), assessment_id: id(5), score: 42.5 }) })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).score, 42.5)
  assert.equal((await originalFetch(url, { method: 'POST', headers, body: '{}' })).status, 400)
  const created = await originalFetch(`${url}/assessments`, { method: 'POST', headers,
    body: JSON.stringify({ class_id: id(2), title: 'Final', assessment_type: 'exam', max_score: 100 }) })
  assert.equal(created.status, 201)
})
