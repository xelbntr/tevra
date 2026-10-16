import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let api
let auth
let cache
const payload = {
  classes: [{ id: 'class-1', name: 'Programming', course_code: 'CS101', academic_year: '2026/2027', semester: '1' }],
  totalStudents: 7,
}

before(async () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
  process.env.VITE_DASHBOARD_URL = 'http://localhost:5000/api/dashboard'
  delete process.env.VITE_ATTENDANCE_URL
  delete process.env.VITE_REPORT_URL
  delete process.env.VITE_AI_CHAT_URL
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    envDir: false,
    mode: 'test',
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true },
    ssr: { noExternal: true },
  })
  api = await server.ssrLoadModule('/src/api.ts')
  ;({ sessionCache: cache } = await server.ssrLoadModule('/src/sessionCache.ts'))
  const { getSupabase } = await server.ssrLoadModule('/src/supabase.ts')
  auth = getSupabase().auth
})

beforeEach(() => {
  cache.clear()
  mock.method(auth, 'getSession', async () => ({ data: { session: { user: { id: 'user-1' }, access_token: 'token-1' } }, error: null }))
})
afterEach(() => mock.restoreAll())
after(async () => { await server?.close() })

test('sends the current token and reads class rows and student totals', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json(payload))
  assert.deepEqual(await api.fetchDashboard(), payload)
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, 'http://localhost:5000/api/dashboard')
  assert.equal(options.headers.Authorization, 'Bearer token-1')
  assert.equal(options.cache, 'no-store')

  auth.getSession.mock.mockImplementation(async () => ({ data: { session: { user: { id: 'user-1' }, access_token: 'token-2' } }, error: null }))
  await api.fetchDashboard()
  assert.equal(request.mock.callCount(), 1, 'token refresh retains the session cache')
  cache.clear()
  await api.fetchDashboard()
  assert.equal(request.mock.calls[1].arguments[1].headers.Authorization, 'Bearer token-2')
})

test('loads the authenticated class roster for grading and reports', async () => {
  const roster = { students: [{ student_id: 'student-1', student_number: 'S001', full_name: 'Ada Lovelace' }] }
  const request = mock.method(globalThis, 'fetch', async () => Response.json(roster))
  assert.deepEqual(await api.fetchClassStudents('class-1'), roster.students)
  const [url, options] = request.mock.calls[0].arguments
  assert.match(url, /^http:\/\/localhost:5000\/api\/attendance\/roster\?/)
  assert.match(url, /class_id=class-1/)
  assert.equal(new URL(url).searchParams.has('date'), false)
  assert.equal(options.headers.Authorization, 'Bearer token-1')
  assert.equal(options.cache, 'no-store')
})

test('requests and validates an authenticated student report', async () => {
  const report = {
    report: {
      title: 'Academic report draft',
      academic_summary: 'Recorded grades are steady.',
      attendance_summary: 'Four entries are available.',
      strengths: [], areas_for_support: [], recommended_next_steps: [], data_limitations: [],
      grade_summary: { graded_assessments: 2, average_percentage: 84.5 },
      attendance_totals: { total: 4, present: 3, late: 0, absent: 1, excused: 0 },
    },
    grade: 84.5,
    attendance: 75,
  }
  const request = mock.method(globalThis, 'fetch', async () => Response.json(report))
  assert.deepEqual(await api.fetchStudentReport('class-1', 'student-1'), report)
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, 'http://localhost:5000/api/reports')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer token-1')
  assert.deepEqual(JSON.parse(options.body), { class_id: 'class-1', student_id: 'student-1' })
})

test('does not request private data when signed out', async () => {
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: null }))
  const request = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })
  await assert.rejects(api.fetchDashboard(), api.AuthenticationError)
  assert.equal(request.mock.callCount(), 0)
})

test('stops when session retrieval fails', async () => {
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: new Error('Refresh failed') }))
  const request = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })
  await assert.rejects(api.fetchDashboard(), /Refresh failed/)
  assert.equal(request.mock.callCount(), 0)
})

test('allows an empty dashboard without inventing statistics', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ classes: [], totalStudents: 0 }))
  assert.deepEqual(await api.fetchDashboard(), { classes: [], totalStudents: 0 })
})

test('handles expired sessions, permissions, and server failures', async () => {
  const request = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }))
  await assert.rejects(api.fetchDashboard(), api.AuthenticationError)
  request.mock.mockImplementation(async () => new Response(null, { status: 403 }))
  await assert.rejects(api.fetchDashboard(), /permission/)
  request.mock.mockImplementation(async () => new Response(null, { status: 500 }))
  await assert.rejects(api.fetchDashboard(), /Could not load/)
})

test('rejects placeholder data, malformed class rows, and non-JSON responses', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ totalStudents: 120, activeCourses: 8 }))
  await assert.rejects(api.fetchDashboard(), /unexpected dashboard response/)
  request.mock.mockImplementation(async () => Response.json({ classes: [{ id: 'missing-fields' }], totalStudents: 1 }))
  await assert.rejects(api.fetchDashboard(), /unexpected dashboard response/)
  request.mock.mockImplementation(async () => Response.json({ classes: [], totalStudents: -1 }))
  await assert.rejects(api.fetchDashboard(), /unexpected dashboard response/)
  request.mock.mockImplementation(async () => new Response('<html>not JSON</html>'))
  await assert.rejects(api.fetchDashboard(), /unexpected dashboard response/)
})

test('reports network failure without exposing request details', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(api.fetchDashboard(), /Could not reach the server/)
})

test('cancelling one dashboard subscriber leaves the shared request alive', async () => {
  const controller = new AbortController()
  let requestSignal
  let complete
  mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    requestSignal = signal
    return new Promise(resolve => { complete = () => resolve(Response.json(payload)) })
  })
  const cancelled = api.fetchDashboard(controller.signal)
  const active = api.fetchDashboard()
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal(requestSignal.aborted, false)
  complete()
  assert.deepEqual(await active, payload)
})

test('concurrent tabs and repeat reads share exactly one dashboard request', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json(payload))
  await Promise.all(Array.from({ length: 10 }, () => api.fetchDashboard()))
  for (let i = 0; i < 20; i++) await api.fetchDashboard()
  assert.equal(request.mock.callCount(), 1)
})

test('switching accounts and signing out evict private data', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json(payload))
  await api.fetchDashboard()
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: { user: { id: 'user-2' }, access_token: 'other-token' } }, error: null }))
  await api.fetchDashboard()
  assert.equal(request.mock.callCount(), 2)
  assert.equal(request.mock.calls[1].arguments[1].headers.Authorization, 'Bearer other-token')
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: null }, error: null }))
  await assert.rejects(api.fetchDashboard(), api.AuthenticationError)
  auth.getSession.mock.mockImplementation(async () => ({ data: { session: { user: { id: 'user-2' }, access_token: 'new-token' } }, error: null }))
  await api.fetchDashboard()
  assert.equal(request.mock.callCount(), 3)
})

test('late responses from a signed-out session cannot repopulate the cache', async () => {
  let complete
  mock.method(globalThis, 'fetch', async () => new Promise(resolve => { complete = () => resolve(Response.json(payload)) }))
  const pending = api.fetchDashboard()
  await new Promise(resolve => setImmediate(resolve))
  cache.setOwner(null)
  complete()
  await assert.rejects(pending, { name: 'AbortError' })
  const request = mock.method(globalThis, 'fetch', async () => Response.json(payload))
  await api.fetchDashboard()
  assert.equal(request.mock.callCount(), 1)
})

test('a delayed local-session read cannot restore data after sign-out', async () => {
  cache.setOwner('user-1')
  let completeSession
  auth.getSession.mock.mockImplementation(() => new Promise(resolve => { completeSession = resolve }))
  const request = mock.method(globalThis, 'fetch', async () => Response.json(payload))
  const pending = api.fetchDashboard()
  cache.setOwner(null)
  completeSession({ data: { session: { user: { id: 'user-1' }, access_token: 'old-token' } }, error: null })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(request.mock.callCount(), 0)
})

test('posts the current prompt to the backend submit route and reads its completion', async () => {
  const completion = {
    result: { choices: [{ message: { role: 'assistant', content: 'Try a group activity.' } }] },
  }
  const request = mock.method(globalThis, 'fetch', async () => Response.json(completion))
  const controller = new AbortController()

  assert.equal(await api.sendAssistantMessage('  Suggest a lesson idea.  ', controller.signal), 'Try a group activity.')
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, 'http://localhost:5000/submit')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), { text: 'Suggest a lesson idea.' })
  assert.equal(options.signal, controller.signal)
})

test('rejects empty AI prompts without sending a request', async () => {
  const request = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request') })
  await assert.rejects(api.sendAssistantMessage('  '), /Enter a message/)
  assert.equal(request.mock.callCount(), 0)
})

test('rejects malformed or empty AI completions, including the obsolete reply format', async () => {
  const request = mock.method(globalThis, 'fetch')
  for (const data of [
    null,
    { reply: 'Old format' },
    { result: {} },
    { result: { choices: [] } },
    { result: { choices: [{ message: null }] } },
    { result: { choices: [{ message: { content: null } }] } },
    { result: { choices: [{ message: { content: 42 } }] } },
    { result: { choices: [{ message: { content: '  ' } }] } },
  ]) {
    request.mock.mockImplementation(async () => Response.json(data))
    await assert.rejects(api.sendAssistantMessage('Hello'), /unexpected response/)
  }
  request.mock.mockImplementation(async () => new Response('<html>not JSON</html>'))
  await assert.rejects(api.sendAssistantMessage('Hello'), /unexpected response/)
})

test('handles JSON and HTML error responses from the AI backend', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Try again later.' }, { status: 429 }))
  await assert.rejects(api.sendAssistantMessage('Hello'), /Try again later/)
  request.mock.mockImplementation(async () => new Response('<html>Server error</html>', { status: 500 }))
  await assert.rejects(api.sendAssistantMessage('Hello'), /could not respond right now/)
})

test('reports an unreachable AI service', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(api.sendAssistantMessage('Hello'), /Could not reach the AI service/)
})

test('preserves AI request cancellation', async () => {
  const controller = new AbortController()
  const request = mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    controller.abort()
    signal.throwIfAborted()
  })
  await assert.rejects(api.sendAssistantMessage('Hello', controller.signal), { name: 'AbortError' })
  await assert.rejects(api.sendAssistantMessage('Hello', controller.signal), { name: 'AbortError' })
  assert.equal(request.mock.callCount(), 1)
})
