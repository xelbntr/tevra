import { getSupabase } from './supabase'
import { sessionCache } from './sessionCache'

export type DashboardClass = {
  id: string
  name: string
  course_code: string
  academic_year: string
  semester: string
}

export type DashboardData = {
  classes: DashboardClass[]
  totalStudents: number
  averageGrade?: number | null
  attendanceRate?: number | null
}

export type ClassStudent = {
  student_id: string
  student_number: string
  full_name: string
}

export type AttendanceStatus = 'present' | 'late' | 'excused' | 'absent'

export type AttendanceStudent = {
  enrollment_id: string
  student_id: string
  student_number: string
  full_name: string
  status: AttendanceStatus | null
  notes: string | null
}

export type AttendanceData = {
  class: DashboardClass
  date: string
  students: AttendanceStudent[]
  summary: {
    totalStudents: number
    present: number
    absent: number
    unmarked: number
    attendanceRate: number | null
  }
  recap: {
    present: number
    late: number
    excused: number
    absent: number
    unmarked: number
  }
}

export type StudentReport = {
  report: {
    title: string
    academic_summary: string
    attendance_summary: string
    strengths: string[]
    areas_for_support: string[]
    recommended_next_steps: string[]
    data_limitations: string[]
    grade_summary: { graded_assessments: number; average_percentage: number | null }
    attendance_totals: { total: number; present: number; late: number; absent: number; excused: number }
  }
  grade: number | null
  attendance: number | null
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantProposal = {
  token: string
  label: string
  before: string | number | null
  after: string | number
}

export async function sendAssistantMessage(text: string, signal?: AbortSignal): Promise<string> {
  return (await sendAssistantChat(text, [], signal)).reply
}

export async function sendAssistantChat(text: string, history: AssistantMessage[] = [], signal?: AbortSignal): Promise<{ reply: string; proposals: AssistantProposal[] }> {
  const prompt = text.trim()
  if (!prompt) throw new Error('Enter a message for the AI assistant.')
  signal?.throwIfAborted()
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(
      (import.meta.env.PROD ? '/submit' : import.meta.env.VITE_AI_CHAT_URL?.trim() || 'http://localhost:5000/submit'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ text: prompt, ...(history.length ? { history: history.slice(-20).map(item => ({ ...item, content: item.content.slice(0, 6000) })) } : {}) }),
        cache: 'no-store',
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the AI service. Make sure the Tevra backend is running.')
  }

  const data: unknown = await response.json().catch(() => null)
  if (response.status === 401) throw new AuthenticationError()
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'The AI could not respond right now. Please try again.'
    throw new Error(message)
  }
  const result = data && typeof data === 'object' && 'result' in data ? data.result : null
  const choices = result && typeof result === 'object' && 'choices' in result ? result.choices : null
  const choice: unknown = Array.isArray(choices) ? choices[0] : null
  const message = choice && typeof choice === 'object' && 'message' in choice ? choice.message : null
  if (!message || typeof message !== 'object' || !('content' in message)
    || typeof message.content !== 'string' || !message.content.trim()) {
    throw new Error('The AI service returned an unexpected response.')
  }
  const proposals = data && typeof data === 'object' && 'proposals' in data ? data.proposals : []
  if (!Array.isArray(proposals) || !proposals.every(p => p && typeof p.token === 'string' && typeof p.label === 'string'
    && (p.before === null || typeof p.before === 'string' || typeof p.before === 'number')
    && (typeof p.after === 'string' || typeof p.after === 'number'))) throw new Error('The AI service returned an unexpected response.')
  return { reply: message.content, proposals }
}

export async function confirmAssistantEdit(token: string): Promise<string> {
  const version = sessionCache.version
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  const endpoint = import.meta.env.PROD ? '/api/assistant/confirm'
    : new URL('/api/assistant/confirm', new URL(import.meta.env.VITE_AI_CHAT_URL?.trim() || 'http://localhost:5000/submit', windowOrigin())).toString()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store', body: JSON.stringify({ token }),
    })
  } catch {
    throw new Error('Could not confirm the save. Check the record before retrying.')
  }
  const data = await response.json().catch(() => null)
  if (response.status === 401) throw new AuthenticationError()
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not save the change.')
  if (!sessionCache.accepts(version, session.user.id)) throw new DOMException('Session changed', 'AbortError')
  sessionCache.clear()
  if (typeof data?.message !== 'string') throw new Error('Unexpected save response. Check the record before retrying.')
  return data.message
}

export class AuthenticationError extends Error {
  constructor() {
    super('Your session is no longer valid. Please sign out and sign in again.')
    this.name = 'AuthenticationError'
  }
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Number.isSafeInteger(data.totalStudents) && (data.totalStudents as number) >= 0
    && ['averageGrade', 'attendanceRate'].every(key => data[key] === undefined || data[key] === null
      || (typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0
        && (key !== 'attendanceRate' || data[key] <= 100)))
    && Array.isArray(data.classes) && data.classes.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return ['id', 'name', 'course_code', 'academic_year', 'semester']
        .every((key) => typeof row[key] === 'string')
    })
}

async function cachedRequest<T>(key: string, loader: (accessToken: string, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const cacheVersion = sessionCache.version
  // Check the current local session even on cache hits; never reuse another user's data.
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) {
    if (cacheVersion === sessionCache.version) sessionCache.setOwner(null)
    throw error
  }
  if (!session) {
    if (cacheVersion === sessionCache.version) sessionCache.setOwner(null)
    throw new AuthenticationError()
  }
  signal?.throwIfAborted()
  if (!sessionCache.accepts(cacheVersion)) {
    throw new DOMException('The signed-in session changed', 'AbortError')
  }
  sessionCache.setOwner(session.user.id)
  return sessionCache.load(key, internalSignal => loader(session.access_token, internalSignal), signal)
}

export function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return cachedRequest('dashboard', loadDashboard, signal)
}

async function loadDashboard(accessToken: string, signal: AbortSignal): Promise<DashboardData> {
  let response: Response
  try {
    response = await fetch(
      (import.meta.env.PROD ? '/api/dashboard' : import.meta.env.VITE_DASHBOARD_URL?.trim() || 'http://localhost:5000/api/dashboard'),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 403) throw new Error('You do not have permission to view this dashboard.')
  if (!response.ok) throw new Error('Could not load the dashboard. Please try again.')

  const data: unknown = await response.json().catch(() => null)
  if (!isDashboardData(data)) {
    throw new Error('The server returned an unexpected dashboard response.')
  }
  return data
}

export function fetchClassStudents(classId: string, signal?: AbortSignal): Promise<ClassStudent[]> {
  return cachedRequest(`roster:${classId}`, (accessToken, internalSignal) => loadClassStudents(classId, accessToken, internalSignal), signal)
}

async function loadClassStudents(classId: string, accessToken: string, signal: AbortSignal): Promise<ClassStudent[]> {
  // Attendance already contains the complete roster. Reuse its in-flight or
  // completed load when both tabs preload the same class, avoiding another API call.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const attendance = sessionCache.get<AttendanceData>(`attendance:${classId}:${today}`)
  if (attendance) {
    try {
      const data = await attendance
      signal.throwIfAborted()
      return data.students.map(({ student_id, student_number, full_name }) => ({ student_id, student_number, full_name }))
    } catch {
      signal.throwIfAborted()
      // An attendance failure should not prevent loading the independent roster.
    }
  }
  let response: Response
  try {
    const endpoint = serviceUrl(import.meta.env.VITE_ATTENDANCE_URL, '/api/attendance')
    const url = new URL(endpoint, windowOrigin())
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/roster`
    url.searchParams.set('class_id', classId)
    url.searchParams.delete('date')
    response = await fetch(endpoint.startsWith('/') ? `${url.pathname}${url.search}` : url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not load students. Check that the Tevra backend is running.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (!response.ok) throw new Error('Could not load students for this class.')
  const data: unknown = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || !('students' in data) || !Array.isArray(data.students)) {
    throw new Error('The server returned an unexpected class roster.')
  }
  const students: ClassStudent[] = []
  for (const student of data.students) {
    if (!student || typeof student !== 'object' || !('student_id' in student) || !('student_number' in student) || !('full_name' in student)
      || typeof student.student_id !== 'string' || typeof student.student_number !== 'string' || typeof student.full_name !== 'string') {
      throw new Error('The server returned an unexpected class roster.')
    }
    students.push({ student_id: student.student_id, student_number: student.student_number, full_name: student.full_name })
  }
  return students
}

function isAttendanceData(value: unknown): value is AttendanceData {
  if (!isRecord(value) || !isRecord(value.class) || !Array.isArray(value.students)
    || !isRecord(value.summary) || !isRecord(value.recap)) return false
  const classData = value.class
  const summary = value.summary
  const recap = value.recap
  const counts = ['present', 'late', 'excused', 'absent', 'unmarked']
  return ['id', 'name', 'course_code', 'academic_year', 'semester']
    .every(key => typeof classData[key] === 'string')
    && typeof value.date === 'string'
    && Number.isSafeInteger(summary.totalStudents) && (summary.totalStudents as number) >= 0
    && ['present', 'absent', 'unmarked'].every(key => Number.isSafeInteger(summary[key]) && (summary[key] as number) >= 0)
    && (summary.attendanceRate === null || (typeof summary.attendanceRate === 'number'
      && Number.isFinite(summary.attendanceRate) && summary.attendanceRate >= 0 && summary.attendanceRate <= 100))
    && counts.every(key => Number.isSafeInteger(recap[key]) && (recap[key] as number) >= 0)
    && value.students.every((student: unknown) => isRecord(student)
      && typeof student.enrollment_id === 'string'
      && typeof student.student_id === 'string'
      && typeof student.student_number === 'string'
      && typeof student.full_name === 'string'
      && (student.status === null || ['present', 'late', 'excused', 'absent'].includes(String(student.status)))
      && (student.notes === null || typeof student.notes === 'string'))
}

export function fetchAttendance(classId: string, date: string, signal?: AbortSignal): Promise<AttendanceData> {
  return cachedRequest(`attendance:${classId}:${date}`, (accessToken, internalSignal) => loadAttendance(classId, date, accessToken, internalSignal), signal)
}

async function loadAttendance(classId: string, date: string, accessToken: string, signal: AbortSignal): Promise<AttendanceData> {
  const endpoint = import.meta.env.PROD
    ? '/api/attendance'
    : import.meta.env.VITE_ATTENDANCE_URL?.trim() || 'http://localhost:5000/api/attendance'
  const url = new URL(endpoint, window.location.origin)
  url.search = new URLSearchParams({ class_id: classId, date }).toString()

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the attendance service. Check your connection and try again.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new Error('This class could not be found or is no longer available to your account.')
  if (!response.ok) throw new Error('Could not load attendance. Please try again.')
  const data: unknown = await response.json().catch(() => null)
  if (!isAttendanceData(data)) throw new Error('The server returned an unexpected attendance response.')
  return data
}

export function fetchStudentReport(classId: string, studentId: string, signal?: AbortSignal): Promise<StudentReport> {
  return cachedRequest(`report:${classId}:${studentId}`, (accessToken, internalSignal) => loadStudentReport(classId, studentId, accessToken, internalSignal), signal)
}

async function loadStudentReport(classId: string, studentId: string, accessToken: string, signal: AbortSignal): Promise<StudentReport> {
  let response: Response
  try {
    response = await fetch(serviceUrl(import.meta.env.VITE_REPORT_URL, '/api/reports'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ class_id: classId, student_id: studentId }),
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the report service. Check that the Tevra backend is running.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) await reportNotFound(response)
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null)
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Could not generate the report. Please try again.'
    throw new Error(message)
  }

  const data: unknown = await response.json().catch(() => null)
  if (!isStudentReport(data)) throw new Error('The server returned an unexpected report.')
  return data
}

export async function downloadStudentGradeReport(classId: string, studentId: string, signal?: AbortSignal): Promise<void> {
  const { blob, filename } = await cachedRequest(`download:${classId}:${studentId}`,
    (accessToken, internalSignal) => loadReportDownload(classId, studentId, accessToken, internalSignal), signal)
  signal?.throwIfAborted()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

async function loadReportDownload(classId: string, studentId: string, accessToken: string, signal: AbortSignal) {
  const endpoint = serviceUrl(import.meta.env.VITE_REPORT_URL, '/api/reports')
  const url = new URL(endpoint, windowOrigin())
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/download`
  let response: Response
  try {
    response = await fetch(endpoint.startsWith('/') ? `${url.pathname}${url.search}` : url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ class_id: classId, student_id: studentId }),
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the report service. Check that the Tevra backend is running.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) await reportNotFound(response)
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null)
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Could not generate the Word report. Please try again.'
    throw new Error(message)
  }

  if (!response.headers.get('Content-Type')?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
    throw new Error('The report service returned an unexpected Word document.')
  }
  const blob = await response.blob()
  signal?.throwIfAborted()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  let filename = plainFilename || 'Laporan_Penilaian_Siswa.docx'
  if (encodedFilename) {
    try { filename = decodeURIComponent(encodedFilename) } catch { /* Keep the plain filename. */ }
  }
  return { blob, filename }
}

function serviceUrl(configured: string | undefined, path: string): string {
  return import.meta.env.PROD ? path : configured?.trim() || `http://localhost:5000${path}`
}

function windowOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:5000' : window.location.origin
}

async function reportNotFound(response: Response): Promise<never> {
  const data: unknown = await response.json().catch(() => null)
  if (isRecord(data) && data.code === 'ENROLLMENT_NOT_FOUND') {
    throw new Error('That student enrollment was not found or is not accessible.')
  }
  throw new Error('The report service is unavailable. Please check the backend configuration.')
}

function isStudentReport(value: unknown): value is StudentReport {
  if (!isRecord(value) || !isRecord(value.report)) return false
  const report = value.report
  const gradeSummary = report.grade_summary
  const attendanceTotals = report.attendance_totals
  if (!isRecord(gradeSummary) || !isRecord(attendanceTotals)) return false
  return typeof report.title === 'string'
    && typeof report.academic_summary === 'string'
    && typeof report.attendance_summary === 'string'
    && Array.isArray(report.strengths) && report.strengths.every(item => typeof item === 'string')
    && Array.isArray(report.areas_for_support) && report.areas_for_support.every(item => typeof item === 'string')
    && Array.isArray(report.recommended_next_steps) && report.recommended_next_steps.every(item => typeof item === 'string')
    && Array.isArray(report.data_limitations) && report.data_limitations.every(item => typeof item === 'string')
    && Number.isSafeInteger(gradeSummary.graded_assessments)
    && (typeof gradeSummary.average_percentage === 'number' || gradeSummary.average_percentage === null)
    && ['total', 'present', 'late', 'absent', 'excused'].every(key => Number.isSafeInteger(attendanceTotals[key]))
    && (typeof value.grade === 'number' || value.grade === null)
    && (typeof value.attendance === 'number' || value.attendance === null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
