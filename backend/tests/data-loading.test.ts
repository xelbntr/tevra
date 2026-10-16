import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-signing-key', alg: 'ES256', use: 'sig' }
const lecturerId = '00000000-0000-4000-8000-000000000001'
const classId = '00000000-0000-4000-8000-000000000002'
const classRow = { id: classId, name: 'Math', course_code: 'M01', academic_year: '2026', semester: '1' }
const students = [
  { id: 'enrollment-1', student: { id: 'student-1', full_name: 'Grace', student_number: 'S001' }, attendance: [] },
  { id: 'enrollment-2', student: { id: 'student-2', full_name: 'Ada', student_number: 'S002' }, attendance: [{ status: 'late', notes: null }] },
]
function token(overrides: Record<string, unknown> = {}, symmetric = false) {
  const header = Buffer.from(JSON.stringify(symmetric ? { alg: 'HS256' } : { alg: 'ES256', kid: jwk.kid })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: lecturerId, iss: 'https://supabase.test/auth/v1', aud: 'authenticated', role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, ...overrides,
  })).toString('base64url')
  const input = `${header}.${payload}`
  return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

const originalFetch = globalThis.fetch
let requests: { url: URL; authorization: string | null }[] = []
let visible = true
let count = 2
let rejectUser = false
let waitForBoth = false
let releaseReads: (() => void) | undefined
let readsStarted = new Set<string>()
let gradeRows = [
  { id: 'grade-1', score: 40, assessment: { max_score: 50 } },
  { id: 'grade-2', score: 90, assessment: { max_score: 100 } },
]
let gradePageSize = 500
let attendanceCount = 4
let presentCount = 3
let gradeError = false
let authenticate: typeof import('../src/auth.js').authenticate
let AuthenticationError: typeof import('../src/auth.js').AuthenticationError
let requestAttendanceData: typeof import('../src/attendance.js').requestAttendanceData
let requestClassRoster: typeof import('../src/attendance.js').requestClassRoster
let requestDashboardData: typeof import('../src/dashboard.js').requestDashboardData

before(async () => {
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_ANON_KEY = 'test-key'
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    requests.push({ url, authorization: request.headers.get('authorization') })
    if (url.pathname.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] })
    if (url.pathname === '/auth/v1/user') {
      return rejectUser ? Response.json({ message: 'Invalid session' }, { status: 401 }) : Response.json({ id: lecturerId })
    }
    if (waitForBoth && ['/rest/v1/classes', '/rest/v1/enrollments'].includes(url.pathname)) {
      readsStarted.add(url.pathname)
      if (readsStarted.size === 2) releaseReads?.()
      else await new Promise<void>(resolve => { releaseReads = resolve })
    }
    if (url.pathname === '/rest/v1/classes') return Response.json(visible ? [classRow] : [])
    if (url.pathname === '/rest/v1/enrollments') {
      return Response.json(students, { headers: { 'Content-Range': `0-1/${count}` } })
    }
    if (url.pathname === '/rest/v1/students') return new Response(null, { headers: { 'Content-Range': '*/2' } })
    if (url.pathname === '/rest/v1/attendance') {
      const total = url.searchParams.has('status') ? presentCount : attendanceCount
      return new Response(null, { headers: { 'Content-Range': `*/${total}` } })
    }
    if (url.pathname === '/rest/v1/grades') {
      if (gradeError) return Response.json({ message: 'Database unavailable' }, { status: 500 })
      const afterId = url.searchParams.get('id')?.replace(/^gt\./, '')
      const remaining = gradeRows.filter(row => !afterId || row.id > afterId)
      const page = remaining.slice(0, gradePageSize)
      return Response.json(page, { headers: { 'Content-Range': `0-${page.length - 1}/${remaining.length}` } })
    }
    throw new Error(`Unexpected request: ${url.pathname}`)
  }
  ;({ authenticate, AuthenticationError } = await import('../src/auth.js'))
  ;({ requestAttendanceData, requestClassRoster } = await import('../src/attendance.js'))
  ;({ requestDashboardData } = await import('../src/dashboard.js'))
})
beforeEach(() => {
  requests = []
  visible = true
  count = 2
  rejectUser = false
  waitForBoth = false
  releaseReads = undefined
  readsStarted = new Set()
  gradeRows = [
    { id: 'grade-1', score: 40, assessment: { max_score: 50 } },
    { id: 'grade-2', score: 90, assessment: { max_score: 100 } },
  ]
  gradePageSize = 500
  attendanceCount = 4
  presentCount = 3
  gradeError = false
})
after(() => { globalThis.fetch = originalFetch })

test('verifies signatures and reuses public signing keys without a per-request Auth call', async () => {
  const accessToken = token()
  assert.equal((await authenticate(accessToken)).user.id, lecturerId)
  assert.equal(requests.length, 1)
  assert.ok(requests[0]!.url.pathname.endsWith('/.well-known/jwks.json'))
  await authenticate(accessToken)
  assert.equal(requests.length, 1, 'second verification is local')
})

test('rejects expired, forged, anonymous, wrong-audience and wrong-issuer tokens', async () => {
  const valid = token()
  const [header, payload, signature] = valid.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: 'another-user' })).toString('base64url')
  for (const invalid of [
    'malformed', token({ exp: 1 }), token({ role: 'anon' }), token({ sub: '' }),
    token({ aud: 'other-app' }), token({ iss: 'https://other-project.test/auth/v1' }),
    `${header}.${forgedPayload}.${signature}`,
  ]) await assert.rejects(authenticate(invalid), AuthenticationError)
  assert.equal(requests.length, 0)
})

test('legacy symmetric tokens still require successful server verification', async () => {
  await authenticate(token({}, true))
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.url.pathname, '/auth/v1/user')
  rejectUser = true
  await assert.rejects(authenticate(token({}, true)), AuthenticationError)
})

test('attendance loads class access and roster concurrently and preserves complete totals', { timeout: 2000 }, async () => {
  waitForBoth = true
  const accessToken = token()
  const result = await requestAttendanceData(accessToken, { class_id: classId, date: '2026-10-16' })
  assert.equal(readsStarted.size, 2)
  assert.deepEqual(result?.summary, { totalStudents: 2, present: 1, absent: 0, unmarked: 1, attendanceRate: 50 })
  assert.equal(result?.students[0]?.full_name, 'Ada')
  assert.ok(requests.every(request => request.authorization === `Bearer ${accessToken}`))
  const enrollmentRead = requests.find(request => request.url.pathname.endsWith('/enrollments'))!
  assert.equal(enrollmentRead.url.searchParams.get('attendance.attendance_date'), 'eq.2026-10-16')
  const classRead = requests.find(request => request.url.pathname.endsWith('/classes'))!
  assert.equal(classRead.url.searchParams.get('lecturer_id'), `eq.${lecturerId}`)
})

test('grading roster uses parallel reads and omits attendance joins', { timeout: 2000 }, async () => {
  waitForBoth = true
  const result = await requestClassRoster(token(), classId)
  assert.deepEqual(result?.students.map(student => student.full_name), ['Ada', 'Grace'])
  const query = requests.find(request => request.url.pathname.endsWith('/enrollments'))!.url.searchParams
  assert.equal(query.get('select'), 'student:students(id,full_name,student_number)')
  assert.equal(query.get('status'), 'eq.active')
  assert.equal(query.has('attendance.attendance_date'), false)
  assert.equal(requests.length, 2)
})

test('access failures return no roster and capped responses cannot show misleading totals', async () => {
  visible = false
  assert.equal(await requestClassRoster(token(), classId), null)
  assert.equal(await requestAttendanceData(token(), { class_id: classId, date: '2026-10-16' }), null)
  visible = true
  count = 3
  await assert.rejects(requestClassRoster(token(), classId), /complete class roster/)
  await assert.rejects(requestAttendanceData(token(), { class_id: classId, date: '2026-10-16' }), /complete class roster/)
})

test('dashboard still returns the authenticated classes and exact student count', async () => {
  const accessToken = token()
  assert.deepEqual(await requestDashboardData(accessToken), {
    classes: [classRow], totalStudents: 2, averageGrade: 85, attendanceRate: 75,
  })
  assert.equal(requests.length, 5)
  assert.ok(requests.every(request => request.authorization === `Bearer ${accessToken}`))
  for (const request of requests.filter(request => /\/(grades|attendance)$/.test(request.url.pathname))) {
    assert.equal(request.url.searchParams.get('enrollment.class_id'), `in.(${classId})`)
  }
  assert.equal(requests.find(request => request.url.searchParams.has('status'))?.url.searchParams.get('status'), 'in.(present,late)')
})

test('dashboard includes all grade pages before calculating its average', async () => {
  gradePageSize = 1
  assert.equal((await requestDashboardData(token())).averageGrade, 85)
  assert.equal(requests.filter(request => request.url.pathname.endsWith('/grades')).length, 2)
})

test('dashboard distinguishes missing records from a real zero', async () => {
  gradeRows = []
  attendanceCount = 0
  presentCount = 0
  assert.deepEqual(await requestDashboardData(token()), {
    classes: [classRow], totalStudents: 2, averageGrade: null, attendanceRate: null,
  })
  gradeRows = [{ id: 'grade-1', score: 0, assessment: { max_score: 100 } }]
  attendanceCount = 4
  const result = await requestDashboardData(token())
  assert.equal(result.averageGrade, 0)
  assert.equal(result.attendanceRate, 0)
})

test('dashboard avoids querying records without accessible classes and propagates query errors', async () => {
  visible = false
  assert.deepEqual(await requestDashboardData(token()), {
    classes: [], totalStudents: 2, averageGrade: null, attendanceRate: null,
  })
  assert.equal(requests.length, 2)
  visible = true
  gradeError = true
  await assert.rejects(requestDashboardData(token()))
})
