import assert from 'node:assert/strict'
import { after, afterEach, before, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const servers = []
const dom = new JSDOM('', { url: 'https://learnly.test/grading-reports' })
const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const roster = { students: [{ student_id: 'student-1', student_number: 'S001', full_name: 'Ada' }] }
let api, auth, configured, configuredAuth, production, productionAuth

async function loadApi(env, prod = false) {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    mode: 'test', server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true }, ssr: { noExternal: true },
    define: { 'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key',
      PROD: prod, ...env,
    }) },
  })
  servers.push(server)
  return [await server.ssrLoadModule('/src/api.ts'), (await server.ssrLoadModule('/src/supabase.ts')).getSupabase().auth]
}

before(async () => {
  ;[api, auth] = await loadApi({})
  ;[configured, configuredAuth] = await loadApi({
    VITE_ATTENDANCE_URL: 'https://backend.test/api/attendance?tenant=school&class_id=old&date=old',
    VITE_REPORT_URL: 'https://backend.test/api/reports/?tenant=school',
  })
  ;[production, productionAuth] = await loadApi({
    VITE_ATTENDANCE_URL: 'http://localhost:5000/wrong', VITE_REPORT_URL: 'http://localhost:5000/wrong',
  }, true)
})
afterEach(() => mock.restoreAll())
after(async () => { await Promise.all(servers.map(server => server.close())); dom.window.close() })

function signIn(clientAuth) {
  mock.method(clientAuth, 'getSession', async () => ({ data: { session: { access_token: 'fresh-token' } }, error: null }))
}

test('roster URLs retain configured query parameters and replace class/date for every endpoint mode', async () => {
  for (const [client, clientAuth, expected] of [
    [api, auth, 'http://localhost:5000/api/attendance'],
    [configured, configuredAuth, 'https://backend.test/api/attendance'],
    [production, productionAuth, '/api/attendance'],
  ]) {
    signIn(clientAuth)
    const request = mock.method(globalThis, 'fetch', async () => Response.json(roster))
    await client.fetchClassStudents('class & 1')
    const [target, options] = request.mock.calls[0].arguments
    assert.ok(target.startsWith(`${expected}?`))
    const url = new URL(target, 'https://learnly.test')
    assert.equal(url.searchParams.get('class_id'), 'class & 1')
    assert.equal(url.searchParams.getAll('class_id').length, 1)
    const today = new Date()
    assert.equal(url.searchParams.get('date'), `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
    if (client === configured) assert.equal(url.searchParams.get('tenant'), 'school')
    assert.equal(options.headers.Authorization, 'Bearer fresh-token')
    mock.restoreAll()
  }
})

test('preview uses same-origin production path and distinguishes missing endpoints from enrollment errors', async () => {
  signIn(productionAuth)
  const request = mock.method(globalThis, 'fetch', async () => new Response('Cannot POST', { status: 404 }))
  await assert.rejects(production.fetchStudentReport('class-1', 'student-1'), /service is unavailable/)
  assert.equal(request.mock.calls[0].arguments[0], '/api/reports')
  request.mock.mockImplementation(async () => Response.json({ code: 'ENROLLMENT_NOT_FOUND' }, { status: 404 }))
  await assert.rejects(production.fetchStudentReport('class-1', 'student-1'), /enrollment was not found/)
})

test('download preserves configured URL queries, sends cancellation, and uses the server filename', async () => {
  signIn(configuredAuth)
  const controller = new AbortController()
  const request = mock.method(globalThis, 'fetch', async () => new Response('word data', { headers: {
    'Content-Type': wordType, 'Content-Disposition': "attachment; filename*=UTF-8''Report%20Ada.docx",
  } }))
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  try {
    mock.method(URL, 'createObjectURL', () => 'blob:test-report')
    const revoke = mock.method(URL, 'revokeObjectURL', () => {})
    let downloaded
    mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { downloaded = this.download })
    mock.method(dom.window, 'setTimeout', callback => { callback(); return 1 })
    await configured.downloadStudentGradeReport('class-1', 'student-1', controller.signal)
    const [target, options] = request.mock.calls[0].arguments
    assert.equal(target, 'https://backend.test/api/reports/download?tenant=school')
    assert.equal(options.signal, controller.signal)
    assert.equal(options.headers.Authorization, 'Bearer fresh-token')
    assert.equal(options.cache, 'no-store')
    assert.deepEqual(JSON.parse(options.body), { class_id: 'class-1', student_id: 'student-1' })
    assert.equal(downloaded, 'Report Ada.docx')
    assert.equal(revoke.mock.callCount(), 1)
    assert.equal(dom.window.document.querySelectorAll('a').length, 0)
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete globalThis.document
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  }
})

test('download cancels before fetch and after receiving a body, and rejects HTML successes', async () => {
  signIn(auth)
  const cancelled = new AbortController()
  cancelled.abort()
  const request = mock.method(globalThis, 'fetch', async () => new Response('<html>SPA</html>'))
  await assert.rejects(api.downloadStudentGradeReport('c', 's', cancelled.signal), { name: 'AbortError' })
  assert.equal(request.mock.callCount(), 0)
  await assert.rejects(api.downloadStudentGradeReport('c', 's'), /unexpected Word document/)
  const controller = new AbortController()
  request.mock.mockImplementation(async () => {
    const response = new Response('doc', { headers: { 'Content-Type': wordType } })
    response.blob = async () => { controller.abort(); return new Blob(['doc']) }
    return response
  })
  await assert.rejects(api.downloadStudentGradeReport('c', 's', controller.signal), { name: 'AbortError' })
})

test('production download uses the same-origin path and retains network cancellation errors', async () => {
  signIn(productionAuth)
  const controller = new AbortController()
  const request = mock.method(globalThis, 'fetch', async (_url, options) => {
    controller.abort()
    options.signal.throwIfAborted()
  })
  await assert.rejects(production.downloadStudentGradeReport('c', 's', controller.signal), { name: 'AbortError' })
  assert.equal(request.mock.calls[0].arguments[0], '/api/reports/download')
})
