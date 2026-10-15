import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let api
let auth
const payload = {
  classes: [{ id: 'class-1', name: 'Programming', course_code: 'CS101', academic_year: '2026/2027', semester: '1' }],
  totalStudents: 7,
}

before(async () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
  process.env.VITE_DASHBOARD_URL = 'http://localhost:5000/api/dashboard'
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
  const { getSupabase } = await server.ssrLoadModule('/src/supabase.ts')
  auth = getSupabase().auth
})

beforeEach(() => {
  mock.method(auth, 'getSession', async () => ({ data: { session: { access_token: 'token-1' } }, error: null }))
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

  auth.getSession.mock.mockImplementation(async () => ({ data: { session: { access_token: 'token-2' } }, error: null }))
  await api.fetchDashboard()
  assert.equal(request.mock.calls[1].arguments[1].headers.Authorization, 'Bearer token-2')
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

test('cancels requests when the dashboard unmounts', async () => {
  const controller = new AbortController()
  let requestSignal
  mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    requestSignal = signal
    controller.abort()
    signal.throwIfAborted()
  })
  await assert.rejects(api.fetchDashboard(controller.signal), { name: 'AbortError' })
  assert.equal(requestSignal, controller.signal)
})
