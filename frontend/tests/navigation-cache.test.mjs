import assert from 'node:assert/strict'
import { after, before, beforeEach, afterEach, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://tevra.test/dashboard' })
const globals = new Map()
const originalFetch = globalThis.fetch
const classes = ['class-1', 'class-2'].map(id => ({ id, name: id, course_code: id, academic_year: '2026', semester: '1' }))
const students = [{ student_id: 'student-1', full_name: 'Ada', student_number: 'S001' }, { student_id: 'student-2', full_name: 'Grace', student_number: 'S002' }]
const report = { grade: 85, attendance: 100, report: {
  title: 'Retained student report', academic_summary: 'Academic draft', attendance_summary: 'Attendance draft',
  strengths: [], areas_for_support: [], recommended_next_steps: [], data_limitations: [],
  grade_summary: { graded_assessments: 1, average_percentage: 85 },
  attendance_totals: { total: 1, present: 1, late: 0, absent: 0, excused: 0 },
} }
let server, React, createRoot, App, api, cache, root, session, authListener, requests, gradebook
const sessionFor = id => ({ user: { id, email: `${id}@tevra.test` }, access_token: `token-${id}` })

before(async () => {
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.__sessionClient = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: callback => {
      authListener = callback
      callback('INITIAL_SESSION', session)
      return { data: { subscription: { unsubscribe() { authListener = null } } } }
    },
    signOut: async () => { session = null; authListener?.('SIGNED_OUT', null); return { error: null } },
  } }
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    mode: 'test', server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true }, esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'session-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === './supabase' && importer?.includes('/src/')) return '\0session-fixture'
      },
      load(id) {
        if (id === '\0session-fixture') return `
          export const supabase = globalThis.__sessionClient;
          export const getSupabase = () => supabase;
          export const supabaseConfigurationError = null;
        `
      },
    }],
  })
  React = await import('react')
  ;({ createRoot } = await import('react-dom/client'))
  ;({ default: App } = await server.ssrLoadModule('/src/App.tsx'))
  api = await server.ssrLoadModule('/src/api.ts')
  ;({ sessionCache: cache } = await server.ssrLoadModule('/src/sessionCache.ts'))
})

beforeEach(() => {
  cache.setOwner(null)
  cache.clear()
  session = sessionFor('teacher-1')
  requests = []
  gradebook = {
    classes,
    students: classes.flatMap(item => students.map((student, index) => ({ ...student, class_id: item.id, enrollment_id: `${item.id}-enrollment-${index}` }))),
    assessments: classes.map(item => ({ id: `${item.id}-quiz`, class_id: item.id, title: 'Quiz 1', assessment_type: 'quiz', max_score: 50 })),
    grades: [{ id: 'grade-1', enrollment_id: 'class-1-enrollment-0', assessment_id: 'class-1-quiz', score: 40 }],
  }
  window.history.replaceState({}, '', '/dashboard')
  globalThis.fetch = async (target, options) => {
    const url = new URL(target, window.location.origin)
    requests.push({ url, options })
    await delay(20) // Simulated network latency makes accidental reloads observable.
    if (url.pathname === '/api/dashboard') return Response.json({ classes, totalStudents: 2 })
    if (url.pathname === '/api/grades') {
      if (options?.method === 'POST') {
        const input = JSON.parse(options.body)
        const previous = gradebook.grades.find(item => item.enrollment_id === input.enrollment_id && item.assessment_id === input.assessment_id)
        const saved = { ...input, id: previous?.id || 'grade-new' }
        gradebook.grades = [...gradebook.grades.filter(item => item.id !== saved.id), saved]
        return Response.json(saved)
      }
      return Response.json(gradebook)
    }
    if (url.pathname === '/api/grades/assessments') {
      const item = { ...JSON.parse(options.body), id: 'new-assessment' }
      gradebook.assessments.push(item)
      return Response.json(item, { status: 201 })
    }
    if (url.pathname === '/api/attendance/roster') return Response.json({ students })
    if (url.pathname === '/api/attendance') return Response.json({
      class: classes.find(row => row.id === url.searchParams.get('class_id')),
      date: url.searchParams.get('date'),
      students: students.map((student, index) => ({ ...student, enrollment_id: `enrollment-${index}`, status: 'present', notes: null })),
      summary: { totalStudents: 2, present: 2, absent: 0, unmarked: 0, attendanceRate: 100 },
      recap: { present: 2, late: 0, absent: 0, excused: 0, unmarked: 0 },
    })
    if (url.pathname === '/api/reports') return Response.json(report)
    throw new Error(`Unexpected request: ${url.pathname}`)
  }
  root = createRoot(document.getElementById('root'))
})
afterEach(async () => { await React.act(async () => root.unmount()); cache.clear() })
after(async () => {
  globalThis.fetch = originalFetch
  await server?.close()
  delete globalThis.__sessionClient
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  dom.window.close()
})

async function settleUntil(predicate) {
  for (let attempt = 0; attempt < 15; attempt++) {
    if (predicate()) return
    await React.act(async () => { await delay(20) })
  }
  assert.ok(predicate(), 'data should finish loading')
}
async function mount() {
  await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))))
  await settleUntil(() => document.querySelector('.attendance-results') && document.querySelector('.reports-page select')?.options.length === 2
    && !document.querySelectorAll('.reports-page select')[1]?.disabled)
}
const navigate = label => React.act(async () => {
  document.querySelector(`nav a[aria-label="${label}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
})
const change = (select, value) => React.act(async () => {
  select.value = value
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})

test('StrictMode shares initial requests and cached tab switches require no network or loading screen', async t => {
  await mount()
  assert.equal(requests.filter(request => request.url.pathname === '/api/dashboard').length, 1)
  assert.equal(requests.length, 2)
  assert.equal(requests.filter(request => request.url.pathname.endsWith('/roster')).length, 0,
    'the grading preload reuses the in-flight attendance roster')
  const start = performance.now()
  for (let i = 0; i < 20; i++) {
    for (const label of ['Attendance', 'Reports', 'Dashboard']) {
      await navigate(label)
      assert.equal(document.querySelector('h1').textContent, label)
      const visible = [...document.querySelectorAll('.dashboard-content > div')].filter(node => !node.hidden)
      assert.ok(visible.every(node => !/Loading (your|attendance|students|classes)/.test(node.textContent)))
    }
  }
  t.diagnostic(`60 cached tab switches: ${((performance.now() - start) / 60).toFixed(2)} ms/switch in the DOM test; zero additional requests`)
  assert.equal(requests.length, 2)
})

test('quick actions open the separate reports and grades workflows', async () => {
  await mount()
  const [reportButton, gradingButton] = document.querySelectorAll('.quick-actions button')
  assert.equal(gradingButton.disabled, false)
  await React.act(async () => reportButton.click())
  assert.equal(window.location.pathname, '/reports')
  assert.equal(document.querySelector('.reports-page').parentElement.hidden, false)
  await React.act(async () => gradingButton.click())
  await settleUntil(() => document.querySelector('.grades-table'))
  assert.equal(window.location.pathname, '/grades')
  assert.equal(document.querySelector('.grades-page').parentElement.hidden, false)
})

const fillInput = (input, value) => React.act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const gradesButton = text => [...document.querySelectorAll('.grades-page button')].find(button => button.textContent === text)

test('old combined-page links open Reports', async () => {
  window.history.replaceState({}, '', '/grading-reports')
  await mount()
  assert.equal(window.location.pathname, '/reports')
  assert.equal(document.querySelector('nav a[aria-current=page]').getAttribute('aria-label'), 'Reports')
})

test('gradebook displays raw scores, edits zero and refreshes reports and dashboard caches', async () => {
  await mount()
  await navigate('Reports')
  await React.act(async () => document.querySelector('.report-selection button').click())
  await settleUntil(() => document.querySelector('.student-report'))
  await navigate('Grades')
  await settleUntil(() => document.querySelector('.grades-table'))
  assert.match(document.querySelector('.grade-cell.is-recorded').textContent, /40.*50/)
  await React.act(async () => document.querySelector('.grade-cell.is-recorded').click())
  assert.equal(document.getElementById('grade-score').value, '40')
  await fillInput(document.getElementById('grade-score'), '0')
  await React.act(async () => document.querySelector('.grades-score-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  await settleUntil(() => document.querySelector('.grades-notice')?.textContent.startsWith('Saved 0/50'))
  await settleUntil(() => requests.filter(item => item.url.pathname === '/api/dashboard').length === 2)
  assert.equal(gradebook.grades.length, 1)
  assert.equal(gradebook.grades[0].score, 0)
  assert.match(document.querySelector('.grade-cell.is-recorded').textContent, /0.*50/)
  assert.equal(document.querySelector('.student-report'), null)
  await navigate('Reports')
  await settleUntil(() => !document.querySelector('.report-selection button').disabled)
  await React.act(async () => document.querySelector('.report-selection button').click())
  await settleUntil(() => document.querySelector('.student-report'))
  assert.equal(requests.filter(item => item.url.pathname === '/api/reports').length, 2)
})

test('new scores explicitly select duplicate names, support decimals and persist a draft across navigation', async () => {
  gradebook.students.forEach(item => { item.full_name = 'Alex' })
  await mount()
  await navigate('Grades')
  await settleUntil(() => document.querySelector('.grades-table'))
  await React.act(async () => gradesButton('Add new score').click())
  await fillInput(document.querySelector('#grade-student-search'), 'Alex')
  assert.equal(document.querySelectorAll('.grades-search-results button').length, 2)
  assert.equal(document.querySelector('.grades-score-form'), null)
  await React.act(async () => document.querySelectorAll('.grades-search-results button')[1].click())
  await change(document.querySelector('.grades-assessment-row select'), 'class-1-quiz')
  assert.equal(document.querySelector('#grade-score').value, '')
  await fillInput(document.querySelector('#grade-score'), '37.5')
  await navigate('Dashboard')
  await navigate('Grades')
  assert.equal(document.querySelector('#grade-score').value, '37.5')
  await React.act(async () => gradesButton('Submit Score').click())
  await settleUntil(() => document.querySelector('.grades-notice')?.textContent.startsWith('Saved 37.5/50'))
  const saved = gradebook.grades.find(item => item.id === 'grade-new')
  assert.equal(saved.enrollment_id, 'class-1-enrollment-1')
  assert.equal(saved.score, 37.5)
})

test('assessment creation adds an ungraded column and failed score saves retain the draft', async () => {
  await mount()
  await navigate('Grades')
  await settleUntil(() => document.querySelector('.grades-table'))
  await React.act(async () => gradesButton('New assessment').click())
  await fillInput(document.querySelector('.grades-assessment-form input'), 'Final exam')
  await React.act(async () => gradesButton('Create assessment').click())
  await settleUntil(() => document.querySelector('.grades-table thead').textContent.includes('Final exam'))
  assert.equal(gradebook.assessments.at(-1).max_score, 100)
  await React.act(async () => document.querySelector('[aria-label="Add Final exam score for Ada (S001)"]').click())
  await fillInput(document.querySelector('#grade-score'), '88')
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (target, options) => options?.method === 'POST' && new URL(target).pathname === '/api/grades'
    ? Response.json({ error: 'Please try saving again.' }, { status: 500 }) : previousFetch(target, options)
  await React.act(async () => gradesButton('Submit Score').click())
  await settleUntil(() => document.querySelector('.grades-page [role=alert]'))
  assert.equal(document.querySelector('#grade-score').value, '88')
  assert.equal(gradesButton('Submit Score').disabled, false)
  assert.match(document.querySelector('.grades-page [role=alert]').textContent, /Please try saving again/)
})

test('assistant previews persist across navigation and saves refresh mounted data views', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (target, options) => {
    const url = new URL(target, window.location.origin)
    if (url.pathname === '/submit') {
      requests.push({ url, options })
      return Response.json({ result: { choices: [{ message: { content: 'Review the change.' } }] },
        proposals: [{ token: 'signed-preview', label: 'Ada · Math · Quiz 1', before: 80, after: 85 }] })
    }
    if (url.pathname === '/api/assistant/confirm') {
      requests.push({ url, options })
      return Response.json({ message: 'Saved: Ada · Math · Quiz 1 — 80 → 85' })
    }
    return previousFetch(target, options)
  }
  await mount()
  await navigate('AI Assistant')
  const textarea = document.querySelector('#assistant-prompt')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Set Ada score to 85')
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    textarea.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await settleUntil(() => document.querySelector('.assistant-change'))
  assert.equal(requests.some(request => request.url.pathname.endsWith('/confirm')), false)
  await navigate('Dashboard')
  await navigate('AI Assistant')
  assert.match(document.querySelector('.assistant-change').textContent, /80.*85/)
  await React.act(async () => document.querySelector('.assistant-change .primary-button').click())
  await settleUntil(() => requests.filter(request => request.url.pathname === '/api/dashboard').length === 2)
  assert.equal(document.querySelector('.assistant-change'), null)
  assert.match(document.querySelector('.chat-transcript').textContent, /Saved: Ada/)
  assert.equal(requests.filter(request => request.url.pathname.endsWith('/confirm')).length, 1)
})

test('assistant replies render Markdown tables, headings, lists and code while user text stays literal', async () => {
  const previousFetch = globalThis.fetch
  const reply = [
    '**Class Overview – 10A (JOINTS Demo)**', '',
    '| Metric | Value |', '| --- | --- |',
    '| Students | 15 |', '| **Average grade** | **84%** |', '',
    '### What the numbers suggest', '- **Grades:** Solid performance.', '- *Attendance:* Needs attention.', '',
    '### Quick actions', '1. Identify missing grades', '2. Review attendance', '   - Contact families', '',
    '[View class](https://example.com/class)', '',
    '`score`', '', '```js', 'const score = 84', '```',
  ].join('\n')
  globalThis.fetch = async (target, options) => {
    if (new URL(target, window.location.origin).pathname === '/submit') {
      return Response.json({ result: { choices: [{ message: { content: reply } }] }, proposals: [] })
    }
    return previousFetch(target, options)
  }
  await mount()
  await navigate('AI Assistant')
  const textarea = document.querySelector('#assistant-prompt')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '**Show** my class\nKeep this line')
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    textarea.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await settleUntil(() => document.querySelector('.chat-markdown table'))
  const answer = document.querySelector('.chat-message-assistant')
  assert.equal(answer.querySelector('strong').textContent, 'Class Overview – 10A (JOINTS Demo)')
  assert.deepEqual([...answer.querySelectorAll('th')].map(cell => cell.textContent), ['Metric', 'Value'])
  assert.equal(answer.querySelectorAll('tbody tr').length, 2)
  assert.equal(answer.querySelector('td strong').textContent, 'Average grade')
  assert.equal(answer.querySelector('h3').textContent, 'What the numbers suggest')
  assert.equal(answer.querySelectorAll('.chat-markdown > ul > li').length, 2)
  assert.equal(answer.querySelector('ol > li > ul > li').textContent, 'Contact families')
  assert.equal(answer.querySelector('a').href, 'https://example.com/class')
  assert.equal(answer.querySelector('pre code').textContent.trim(), 'const score = 84')
  assert.ok(answer.querySelector('table').closest('.chat-table-wrapper'))
  const question = document.querySelector('.chat-message-user')
  assert.equal(question.querySelector('p').textContent, '**Show** my class\nKeep this line')
  assert.equal(question.querySelector('strong'), null)
})

test('assistant Markdown does not render raw HTML or unsafe links', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (target, options) => {
    if (new URL(target, window.location.origin).pathname === '/submit') {
      return Response.json({ result: { choices: [{ message: { content:
        '**Safe text**\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)',
      } }] }, proposals: [] })
    }
    return previousFetch(target, options)
  }
  await mount()
  await navigate('AI Assistant')
  const textarea = document.querySelector('#assistant-prompt')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Show my class')
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    textarea.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await settleUntil(() => document.querySelector('.chat-markdown strong'))
  const answer = document.querySelector('.chat-markdown')
  assert.equal(answer.querySelector('strong').textContent, 'Safe text')
  assert.equal(answer.querySelector('script, img, [onerror]'), null)
  assert.ok(!answer.querySelector('a').getAttribute('href')?.startsWith('javascript:'))
})

test('attendance class and grading selections and previews survive leaving the tab', async () => {
  await mount()
  await navigate('Attendance')
  await change(document.querySelector('.attendance-toolbar select'), 'class-2')
  await settleUntil(() => document.querySelector('.attendance-class-kicker')?.textContent.startsWith('class-2'))
  await navigate('Reports')
  await change(document.querySelectorAll('.reports-page select')[1], 'student-2')
  await React.act(async () => document.querySelector('.report-selection button').click())
  await settleUntil(() => document.querySelector('.student-report'))
  const count = requests.length
  await navigate('Dashboard')
  await navigate('Attendance')
  assert.equal(document.querySelector('.attendance-toolbar select').value, 'class-2')
  await navigate('Reports')
  assert.equal(document.querySelectorAll('.reports-page select')[1].value, 'student-2')
  assert.match(document.querySelector('.student-report').textContent, /Retained student report/)
  await React.act(async () => document.querySelector('.report-selection button').click())
  assert.equal(requests.length, count, 'preview also reuses the selected student report')
})

test('attendance cache separates dates and classes and reuses each loaded selection', async () => {
  await mount()
  await api.fetchAttendance('class-1', '2026-10-01')
  await api.fetchAttendance('class-1', '2026-10-02')
  await api.fetchAttendance('class-2', '2026-10-01')
  const count = requests.length
  assert.equal((await api.fetchAttendance('class-1', '2026-10-01')).date, '2026-10-01')
  assert.equal((await api.fetchAttendance('class-2', '2026-10-01')).class.id, 'class-2')
  assert.equal(requests.length, count)
})

test('other grading classes use the lightweight roster and cache it for return visits', async () => {
  await mount()
  await navigate('Reports')
  const classSelect = document.querySelector('.reports-page select')
  await change(classSelect, 'class-2')
  await settleUntil(() => !document.querySelectorAll('.reports-page select')[1].disabled)
  assert.equal(requests.filter(request => request.url.pathname === '/api/attendance/roster').length, 1)
  assert.equal(requests.at(-1).url.searchParams.get('class_id'), 'class-2')
  const count = requests.length
  await change(classSelect, 'class-1')
  await change(classSelect, 'class-2')
  assert.equal(requests.length, count)
})

test('an attendance failure falls back to the lightweight grading roster', async () => {
  const successfulFetch = globalThis.fetch
  globalThis.fetch = async (target, options) => {
    if (new URL(target, window.location.origin).pathname === '/api/attendance') {
      return new Response(null, { status: 500 })
    }
    return successfulFetch(target, options)
  }
  await React.act(async () => root.render(React.createElement(App)))
  await settleUntil(() => document.querySelectorAll('.reports-page select')[1]?.options.length === 2)
  assert.ok(requests.some(request => request.url.pathname.endsWith('/roster')))
  assert.match(document.querySelector('.attendance-message[role="alert"]').textContent, /Could not load attendance/)
})

test('token refresh retains data, while signing out and changing accounts clear all views', async () => {
  await mount()
  const count = requests.length
  session = { ...session, access_token: 'refreshed-token' }
  await React.act(async () => authListener('TOKEN_REFRESHED', session))
  await navigate('Attendance')
  await api.fetchDashboard()
  assert.equal(requests.length, count)
  await React.act(async () => document.querySelector('.profile-button').click())
  await React.act(async () => document.querySelector('.sign-out-button').click())
  assert.equal(document.querySelector('.attendance-results'), null)
  session = sessionFor('teacher-2')
  await React.act(async () => authListener('SIGNED_IN', session))
  await settleUntil(() => document.querySelector('.attendance-results'))
  await settleUntil(() => requests.length === count + 2)
  assert.ok(requests.slice(count).every(request => request.options.headers.Authorization === 'Bearer token-teacher-2'))
})
