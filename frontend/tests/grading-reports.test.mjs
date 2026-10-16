import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://tevra.test/grading-reports' })
const globals = new Map()
let server, React, createRoot, GradingReports, root
const students = [{ student_id: 'student-1', full_name: 'Ada', student_number: 'S001' }, { student_id: 'student-2', full_name: 'Grace', student_number: 'S002' }]
const classes = ['class-1', 'class-2', 'class-3'].map(id => ({ id, name: id, course_code: id, academic_year: '2026', semester: '1' }))
const report = {
  grade: 85, attendance: 100,
  report: { title: 'Ada report', academic_summary: 'Academic draft', attendance_summary: 'Attendance draft', strengths: [], areas_for_support: [], recommended_next_steps: [], data_limitations: [], grade_summary: { graded_assessments: 1, average_percentage: 85 }, attendance_totals: { total: 1, present: 1, late: 0, absent: 0, excused: 0 } },
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

before(async () => {
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    mode: 'test', server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true }, esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'grading-api-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === './api' && importer?.endsWith('/GradingReports.tsx')) return '\0grading-api'
      },
      load(id) {
        if (id === '\0grading-api') return ['fetchDashboard', 'fetchClassStudents', 'fetchStudentReport', 'downloadStudentGradeReport']
          .map(name => `export const ${name} = (...args) => globalThis.__gradingApi.${name}(...args);`).join('\n')
      },
    }],
  })
  React = await import('react')
  ;({ createRoot } = await import('react-dom/client'))
  ;({ GradingReports } = await server.ssrLoadModule('/src/GradingReports.tsx'))
})

beforeEach(() => {
  globalThis.__gradingApi = {
    fetchDashboard: async () => ({ classes, totalStudents: 2 }),
    fetchClassStudents: async () => students,
    fetchStudentReport: async () => report,
    downloadStudentGradeReport: async () => {},
  }
  root = createRoot(document.getElementById('root'))
})
afterEach(async () => {
  if (root) await React.act(async () => root.unmount())
  root = null
  delete globalThis.__gradingApi
})
after(async () => {
  await server?.close()
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  dom.window.close()
})

const mount = () => React.act(async () => root.render(React.createElement(GradingReports)))
const selectors = () => [...document.querySelectorAll('select')]
const buttons = () => [...document.querySelectorAll('button')]
const change = (select, value) => React.act(async () => {
  select.value = value
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})

test('preview locks both selectors, prevents mismatched selection, then unlocks on success', async () => {
  const pending = deferred()
  let selection
  globalThis.__gradingApi.fetchStudentReport = (...args) => { selection = args; return pending.promise }
  await mount()
  await React.act(async () => buttons()[0].click())
  assert.ok(selectors().every(select => select.disabled))
  assert.ok(buttons().every(button => button.disabled))
  await change(selectors()[1], 'student-2')
  assert.equal(selection[0], 'class-1')
  assert.equal(selection[1], 'student-1')
  await React.act(async () => pending.resolve(report))
  assert.ok(selectors().every(select => !select.disabled))
  assert.equal(selectors()[1].value, 'student-1')
  assert.match(document.body.textContent, /Ada report/)
})

test('preview and download failures unlock controls and show their error', async () => {
  for (const [name, button] of [['fetchStudentReport', 0], ['downloadStudentGradeReport', 1]]) {
    const pending = deferred()
    globalThis.__gradingApi[name] = () => pending.promise
    if (!document.querySelector('select')) await mount()
    await React.act(async () => buttons()[button].click())
    assert.ok(selectors().every(select => select.disabled))
    await React.act(async () => pending.reject(new Error('Service failed')))
    assert.ok(selectors().every(select => !select.disabled))
    assert.equal(document.querySelector('[role="alert"]').textContent, 'Service failed')
  }
})

test('download holds the selection until it finishes', async () => {
  const pending = deferred()
  globalThis.__gradingApi.downloadStudentGradeReport = () => pending.promise
  await mount()
  await React.act(async () => buttons()[1].click())
  assert.ok(selectors().every(select => select.disabled))
  await React.act(async () => pending.resolve())
  assert.ok(selectors().every(select => !select.disabled))
})

test('rapid class changes clear old data and ignore a late roster response even if it ignores abort', async () => {
  const middle = deferred()
  let middleSignal
  globalThis.__gradingApi.fetchClassStudents = async (classId, signal) => {
    if (classId === 'class-2') { middleSignal = signal; return middle.promise }
    return classId === 'class-3' ? [{ ...students[1], student_id: 'latest-student' }] : students
  }
  await mount()
  await React.act(async () => buttons()[0].click())
  assert.match(document.body.textContent, /Ada report/)
  await change(selectors()[0], 'class-2')
  assert.doesNotMatch(document.body.textContent, /Ada report/)
  assert.equal(selectors()[1].value, '')
  assert.equal(selectors()[1].disabled, true)
  assert.ok(buttons().every(button => button.disabled))
  await change(selectors()[0], 'class-3')
  assert.equal(middleSignal.aborted, true)
  assert.equal(selectors()[1].value, 'latest-student')
  await React.act(async () => middle.resolve(students))
  assert.equal(selectors()[1].value, 'latest-student')
})

test('unmount cancels preview and download without applying late results', async () => {
  for (const [name, button] of [['fetchStudentReport', 0], ['downloadStudentGradeReport', 1]]) {
    const pending = deferred()
    let requestSignal
    globalThis.__gradingApi[name] = (_classId, _studentId, signal) => { requestSignal = signal; return pending.promise }
    await mount()
    await React.act(async () => buttons()[button].click())
    await React.act(async () => root.unmount())
    root = null
    assert.equal(requestSignal.aborted, true)
    await React.act(async () => pending.resolve(report))
    assert.equal(document.getElementById('root').textContent, '')
    root = createRoot(document.getElementById('root'))
  }
})
