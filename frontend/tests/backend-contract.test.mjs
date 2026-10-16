import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createServer } from 'vite'

test('frontend uses the running backend submit contract', { timeout: 15_000 }, async (t) => {
  let upstreamRequest
  const upstream = createHttpServer(async (request, response) => {
    if (request.url === '/auth/v1/user') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }))
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    upstreamRequest = { method: request.method, url: request.url, body: JSON.parse(body) }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'completion-test',
      choices: [{ message: { role: 'assistant', content: 'Start with a group discussion.' } }],
    }))
  })
  t.after(() => new Promise((resolve) => {
    upstream.close(resolve)
    upstream.closeAllConnections()
  }))
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')

  const reservation = createHttpServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const backendPort = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const backend = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: fileURLToPath(new URL('../../backend/', import.meta.url)),
    env: {
      ...process.env,
      PORT: String(backendPort),
      AI_API_KEY: 'test-key',
      GROQ_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SUPABASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SUPABASE_ANON_KEY: 'test-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  let startupError
  backend.stdout.on('data', (chunk) => { output += chunk })
  backend.stderr.on('data', (chunk) => { output += chunk })
  backend.on('error', (error) => { startupError = error })
  t.after(async () => {
    if (backend.exitCode === null && backend.signalCode === null && backend.pid) {
      const exited = once(backend, 'exit')
      backend.kill()
      await exited
    }
  })

  let ready = false
  let healthError
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError
    if (backend.exitCode !== null) throw new Error(`Backend failed to start: ${output}`)
    try {
      const health = await fetch(`${backendUrl}/api/v1/health`, { signal: AbortSignal.timeout(100) })
      assert.equal((await health.json()).status, 'ok')
      ready = true
      break
    } catch (error) {
      healthError = error
      await delay(50)
    }
  }
  assert.ok(ready, `Backend did not become ready: ${output}\n${healthError?.stack}\n${healthError?.cause}`)

  // Exercise the frontend's default path against this backend's temporary port.
  delete process.env.VITE_AI_CHAT_URL
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  const frontend = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    envDir: false,
    mode: 'test',
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true },
    ssr: { noExternal: true },
  })
  t.after(() => frontend.close())
  const api = await frontend.ssrLoadModule('/src/api.ts')
  const { getSupabase } = await frontend.ssrLoadModule('/src/supabase.ts')
  const jwt = [
    { alg: 'HS256', typ: 'JWT' },
    { sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated',
      iss: `http://127.0.0.1:${upstream.address().port}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 3600 },
  ].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.test-signature'
  t.mock.method(getSupabase().auth, 'getSession', async () => ({ data: { session: { access_token: jwt } }, error: null }))
  const originalFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const target = new URL(url)
    if (target.origin === 'http://localhost:5000') target.host = `127.0.0.1:${backendPort}`
    return originalFetch(target, options)
  })

  assert.equal(await api.sendAssistantMessage('Suggest a classroom activity.'), 'Start with a group discussion.')
  assert.equal(upstreamRequest.method, 'POST')
  assert.equal(upstreamRequest.url, '/openai/v1/chat/completions')
  assert.equal(upstreamRequest.body.messages[0].role, 'system')
  assert.deepEqual(upstreamRequest.body.messages[1], { role: 'user', content: 'Suggest a classroom activity.' })
  assert.ok(upstreamRequest.body.tools.some(tool => tool.function.name === 'propose_edit'))
  const anonymousChat = await originalFetch(`${backendUrl}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'List my classes' }),
  })
  assert.equal(anonymousChat.status, 401)
  assert.equal(anonymousChat.headers.get('cache-control'), 'no-store')

  const dashboard = await originalFetch(`${backendUrl}/api/dashboard`)
  assert.equal(dashboard.status, 401)
  assert.deepEqual(await dashboard.json(), { error: 'Please sign in' })

  const roster = await originalFetch(`${backendUrl}/api/attendance/roster?class_id=invalid`)
  assert.equal(roster.status, 401)
  assert.equal(roster.headers.get('cache-control'), 'no-store')
  const invalidRoster = await originalFetch(`${backendUrl}/api/attendance/roster?class_id=invalid`, {
    headers: { Authorization: 'Bearer test-token' },
  })
  assert.equal(invalidRoster.status, 400)

  for (const path of ['/api/reports', '/api/reports/download']) {
    const report = await originalFetch(`${backendUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(report.status, 401)
    assert.equal(report.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await report.json(), { error: 'Please sign in' })
    const malformed = await originalFetch(`${backendUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    })
    assert.equal(malformed.status, 400)
    assert.match((await malformed.json()).error, /valid JSON/)
  }
})
