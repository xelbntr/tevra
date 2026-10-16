import { getSupabase } from './supabase'

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
}

export type ClassStudent = {
  student_id: string
  student_number: string
  full_name: string
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

export async function sendAssistantMessage(text: string, signal?: AbortSignal): Promise<string> {
  const prompt = text.trim()
  if (!prompt) throw new Error('Enter a message for the AI assistant.')
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(
      import.meta.env.VITE_AI_CHAT_URL?.trim() || 'http://localhost:5000/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt }),
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the AI service. Make sure the Learnly backend is running.')
  }

  const data: unknown = await response.json().catch(() => null)
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
  return message.content
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
    && Array.isArray(data.classes) && data.classes.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return ['id', 'name', 'course_code', 'academic_year', 'semester']
        .every((key) => typeof row[key] === 'string')
    })
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  // Read the current session each time so refreshed tokens are used.
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(
      import.meta.env.VITE_DASHBOARD_URL?.trim() || 'http://localhost:5000/api/dashboard',
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
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

export async function fetchClassStudents(classId: string, signal?: AbortSignal): Promise<ClassStudent[]> {
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  signal?.throwIfAborted()

  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  let response: Response
  try {
    const url = new URL('http://localhost:5000/api/attendance')
    url.search = new URLSearchParams({ class_id: classId, date }).toString()
    response = await fetch(import.meta.env.VITE_ATTENDANCE_URL?.trim() || url.toString(), {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not load students. Check that the Learnly backend is running.')
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

export async function fetchStudentReport(classId: string, studentId: string, signal?: AbortSignal): Promise<StudentReport> {
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(import.meta.env.VITE_REPORT_URL?.trim() || 'http://localhost:5000/api/reports', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ class_id: classId, student_id: studentId }),
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the report service. Check that the Learnly backend is running.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new Error('That student is no longer enrolled in this class.')
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

export async function downloadStudentGradeReport(classId: string, studentId: string): Promise<void> {
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()

  const baseUrl = import.meta.env.VITE_REPORT_URL?.trim() || 'http://localhost:5000/api/reports'
  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ class_id: classId, student_id: studentId }),
      cache: 'no-store',
    })
  } catch {
    throw new Error('Could not reach the report service. Check that the Learnly backend is running.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new Error('That student is no longer enrolled in this class.')
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null)
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Could not generate the Word report. Please try again.'
    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = encodedFilename
    ? decodeURIComponent(encodedFilename)
    : plainFilename || 'Laporan_Penilaian_Siswa.docx'
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
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
