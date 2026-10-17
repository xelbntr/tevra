import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://tevra.test/' })
const globals = new Map()
let server, React, createRoot, AuthGate, root, calls, signupResult, signinError, authListener, dashboardSessions
const testSession = { user: { id: 'new-teacher', email: 'teacher+class@proton.me' }, access_token: 'test-token' }

before(async () => {
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.__authEmailClient = { auth: {
    onAuthStateChange(callback) {
      authListener = callback
      callback('INITIAL_SESSION', null)
      return { data: { subscription: { unsubscribe() { authListener = null } } } }
    },
    async signInWithPassword(input) {
      calls.push({ method: 'signin', input })
      if (!signinError) authListener?.('SIGNED_IN', testSession)
      return { error: signinError }
    },
  } }
  globalThis.__createAccount = async (email, password) => {
    calls.push({ method: 'signup', input: { email, password } })
    return signupResult
  }
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    mode: 'test', server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true }, esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'auth-email-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === './supabase' && importer?.endsWith('/AuthGate.tsx')) return '\0auth-email-fixture'
      },
      load(id) {
        if (id === '\0auth-email-fixture') return `
          export const supabase = globalThis.__authEmailClient;
          export const getSupabase = () => supabase;
          export const createAccount = (...args) => globalThis.__createAccount(...args);
          export const supabaseConfigurationError = null;
        `
      },
    }],
  })
  React = await import('react')
  ;({ createRoot } = await import('react-dom/client'))
  ;({ AuthGate } = await server.ssrLoadModule('/src/AuthGate.tsx'))
})

beforeEach(() => {
  calls = []
  dashboardSessions = []
  signupResult = { data: { session: testSession }, error: null }
  signinError = null
  root = createRoot(document.getElementById('root'))
})
afterEach(async () => { await React.act(async () => root.unmount()) })
after(async () => {
  await server?.close()
  delete globalThis.__authEmailClient
  delete globalThis.__createAccount
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  dom.window.close()
})

async function mount(mode) {
  await React.act(async () => root.render(React.createElement(AuthGate, null, session => {
    dashboardSessions.push(session)
    return React.createElement('div', { 'data-testid': 'dashboard' }, 'Dashboard')
  })))
  if (mode === 'signup') await switchMode()
}
const switchMode = () => React.act(async () => document.querySelector('.auth-switch button').click())
const emailField = () => document.querySelector('input[type="email"]')
const fieldError = () => document.querySelector('.auth-field-error')
const focus = input => React.act(async () => input.focus())
const blur = input => React.act(async () => input.blur())
const type = (input, value) => React.act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
async function fillPassword(mode) {
  await type(document.getElementById(`${mode}-password`), 'test-password-123')
  if (mode === 'signup') await type(document.getElementById('confirm-password'), 'test-password-123')
}

const validEmails = [
  'test234@gmail.com', 'teacher@proton.me', 'Teacher@EXAMPLE.COM',
  'first.last+class@example.co.id', 'teacher_name@school-name.edu',
  "o'connor@staff.example.school", 'teacher@localhost',
]
const invalidEmails = [
  '', '   ', 'teacher', 'teacher.example.com', '@example.com', 'teacher@',
  'teacher@@example.com', 'first last@example.com', 'teacher@exam ple.com',
  'teacher@example..com', 'teacher@.example.com', 'teacher@example.com.',
  'teacher@-example.com', 'teacher@example-.com', 'teacher@exam_ple.com',
  'one@example.com,two@example.com',
]

for (const mode of ['signin', 'signup']) {
  for (const [valid, values] of [[true, validEmails], [false, invalidEmails]]) {
    for (const value of values) {
      test(`${mode}: ${valid ? 'accepts' : 'rejects'} ${JSON.stringify(value)} after blur`, async () => {
        await mount(mode)
        const input = emailField()
        await focus(input)
        await type(input, value)
        assert.equal(fieldError(), null, 'typing must not show an error')
        await blur(input)
        if (valid) {
          assert.equal(fieldError(), null)
          assert.equal(input.hasAttribute('aria-invalid'), false)
        } else {
          assert.equal(fieldError()?.textContent, 'Email is invalid')
          assert.equal(input.getAttribute('aria-invalid'), 'true')
          assert.equal(input.getAttribute('aria-describedby'), fieldError().id)
          assert.equal(input.nextElementSibling, fieldError(), 'feedback sits directly below the email field')
        }
      })
    }
  }

  test(`${mode}: validates only on blur and clears feedback on focus`, async () => {
    await mount(mode)
    const input = emailField()
    const getValidity = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'validity').get
    let reads = 0
    Object.defineProperty(input, 'validity', { configurable: true, get() { reads++; return getValidity.call(this) } })
    await focus(input)
    for (const value of ['bad', 'valid@example.com', 'invalid-again']) await type(input, value)
    assert.equal(reads, 0)
    assert.equal(fieldError(), null)
    await blur(input)
    assert.equal(reads, 1)
    assert.ok(fieldError())
    await focus(input)
    assert.equal(reads, 1, 'focus clears feedback without revalidating')
    assert.equal(fieldError(), null)
    assert.equal(input.hasAttribute('aria-invalid'), false)
    await type(input, 'corrected@example.com')
    assert.equal(reads, 1, 'corrections do not trigger validation while typing')
    await blur(input)
    assert.equal(reads, 2)
    assert.equal(fieldError(), null)
  })

  test(`${mode}: invalid submission suppresses the browser popup and never calls auth`, async () => {
    await mount(mode)
    const input = emailField()
    await focus(input)
    await type(input, 'invalid')
    await fillPassword(mode)
    let invalidEvent
    input.addEventListener('invalid', event => { invalidEvent = event })
    await React.act(async () => document.querySelector('form').requestSubmit())
    assert.ok(invalidEvent?.defaultPrevented, 'cancel native email validation UI')
    assert.deepEqual(calls, [])
    assert.equal(fieldError(), null, 'Enter does not show feedback while the email remains focused')
    await blur(input)
    assert.equal(fieldError()?.textContent, 'Email is invalid')
    await React.act(async () => document.querySelector('form').requestSubmit())
    assert.equal(fieldError()?.textContent, 'Email is invalid')
    assert.deepEqual(calls, [])
  })

  test(`${mode}: valid submission still sends the email and password`, async () => {
    await mount(mode)
    await focus(emailField())
    await type(emailField(), 'teacher+class@proton.me')
    await blur(emailField())
    await fillPassword(mode)
    await React.act(async () => document.querySelector('form').requestSubmit())
    assert.deepEqual(calls, [{ method: mode, input: { email: 'teacher+class@proton.me', password: 'test-password-123' } }])
    assert.equal(fieldError(), null)
  })

  test(`${mode}: empty passwords still block submission and the minimum length remains six`, async () => {
    await mount(mode)
    await type(emailField(), 'teacher@example.com')
    await React.act(async () => document.querySelector('form').requestSubmit())
    assert.deepEqual(calls, [])
    assert.equal(document.getElementById(`${mode}-password`).minLength, 6)
  })

  test(`${mode}: exposes explicit email autofill semantics`, async () => {
    await mount(mode)
    const input = emailField()
    assert.equal(input.type, 'email')
    assert.equal(input.name, 'email')
    assert.equal(input.autocomplete, 'email')
    assert.equal(input.inputMode, 'email')
    assert.equal(input.getAttribute('autocapitalize'), 'none')
    assert.equal(input.getAttribute('spellcheck'), 'false')
    assert.equal(input.labels[0].textContent, 'Email')
  })
}

test('switching auth modes clears the previous email warning', async () => {
  await mount('signin')
  await focus(emailField())
  await type(emailField(), 'invalid')
  await blur(emailField())
  assert.ok(fieldError())
  await switchMode()
  assert.equal(fieldError(), null)
  assert.equal(emailField().hasAttribute('aria-invalid'), false)
  assert.equal(emailField().value, 'invalid')
})

async function submitSignup() {
  await mount('signup')
  await type(emailField(), 'teacher+class@proton.me')
  await fillPassword('signup')
  await React.act(async () => document.querySelector('form').requestSubmit())
}

test('signup returns to login with an accessible success block and no automatic dashboard', async () => {
  await submitSignup()
  assert.ok(document.getElementById('signin-form'))
  assert.equal(document.getElementById('signup-form'), null)
  assert.equal(document.querySelector('.auth-success[role="status"]').textContent, 'Account successfully created. Please log in.')
  assert.equal(document.querySelector('.auth-success').getAttribute('aria-live'), 'polite')
  assert.equal(emailField().value, 'teacher+class@proton.me')
  assert.equal(document.getElementById('signin-password').value, '')
  assert.equal(document.activeElement, document.getElementById('signin-password'))
  assert.equal(document.body.textContent.includes('confirmation link'), false)
  assert.equal(document.body.textContent.includes('verification'), false)
  assert.deepEqual(dashboardSessions, [])

  await type(document.getElementById('signin-password'), 'test-password-123')
  await React.act(async () => document.querySelector('form').requestSubmit())
  assert.ok(document.querySelector('[data-testid="dashboard"]'))
})

test('signup failure keeps the signup form and shows no success message', async () => {
  signupResult = { data: { session: null }, error: new Error('Unable to create account') }
  await submitSignup()
  assert.ok(document.getElementById('signup-form'))
  assert.equal(document.querySelector('.auth-success'), null)
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Unable to create account')
})

test('signup without a session never claims success or asks for email verification', async () => {
  signupResult = { data: { session: null }, error: null }
  await submitSignup()
  assert.ok(document.getElementById('signup-form'))
  assert.equal(document.querySelector('.auth-success'), null)
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Account creation could not be completed. Please try again.')
})

test('a failed login clears the signup success message and displays the login error', async () => {
  await submitSignup()
  signinError = new Error('Invalid login credentials')
  await type(document.getElementById('signin-password'), 'wrong-password')
  await React.act(async () => document.querySelector('form').requestSubmit())
  assert.equal(document.querySelector('.auth-success'), null)
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Invalid login credentials')
})
