import { createClient } from '@supabase/supabase-js'
import env from 'dotenv'
import { z } from 'zod'
import { generateStudentReport } from './report.js'
import type { GeneratedReport } from './report.js'
    
env.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

export class AuthenticationError extends Error {}

async function authenticate(accessToken: string) {
  const db = createClient(supabaseUrl!, supabaseKey!, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { data: { user }, error: authError } = await db.auth.getUser(accessToken)
  if (authError || !user) {
    throw new AuthenticationError('Invalid or expired session')
  }

  return { db, user }
}

export async function requestDashboardData(accessToken: string) {
  const { db, user } = await authenticate(accessToken)

  const [classesResult, studentsResult] = await Promise.all([
    db.from('classes')
      .select('id, name, course_code, academic_year, semester')
      .eq('lecturer_id', user.id)
      .order('created_at', { ascending: false }),

    db.from('students').select('id', { count: 'exact', head: true }),
  ])

  if (classesResult.error) throw classesResult.error
  if (studentsResult.error) throw studentsResult.error

  return {
    classes: classesResult.data ?? [],
    totalStudents: studentsResult.count ?? 0,
  }
}

export async function addNewGrade(accessToken: string, input: { enrollment_id: string,  assessment_id: string, score: number, feedback: string | null }) {
  const { db } = await authenticate(accessToken)

  const { data, error } = await db
    .from('grades')
    .insert({
      enrollment_id: input.enrollment_id,
      assessment_id: input.assessment_id,
      score: input.score,
      feedback: input.feedback
    })
    .single()

  if (error) throw error

  return data
}

const reportInputSchema = z.object({ class_id: z.uuid(), student_id: z.uuid() })

export async function generateReport(
  accessToken: string,
  input: { class_id: string, student_id: string },
): Promise<GeneratedReport | null> {
  const selection = reportInputSchema.parse(input)
  const { db } = await authenticate(accessToken)

  const { data: enrollment, error } = await db
    .from('enrollments')
    .select(`
      id, status,
      student:students(id, student_number, full_name),
      class:classes(id, name, course_code, academic_year, semester)
    `)
    .eq('student_id', selection.student_id)
    .eq('class_id', selection.class_id)
    .maybeSingle()

  if (error) throw error
  // RLS hides enrollments outside the signed-in lecturer's classes.
  if (!enrollment) return null

  // Fetch both histories concurrently, paging to avoid Supabase's row limit.
  // Each query still uses the authenticated client and the selected enrollment.
  const [attendance, grades] = await Promise.all([
    readAllReportRows((afterId) => {
      const query = db.from('attendance')
        .select('id, attendance_date, status, notes', { count: 'exact' })
        .eq('enrollment_id', enrollment.id)
        .order('id')
        .limit(500)
      return afterId ? query.gt('id', afterId) : query
    }),
    readAllReportRows((afterId) => {
      const query = db.from('grades')
        .select(`
          id, score, feedback, graded_at,
          assessment:assessments(id, title, assessment_type, max_score, weight, due_date)
        `, { count: 'exact' })
        .eq('enrollment_id', enrollment.id)
        .order('id')
        .limit(500)
      return afterId ? query.gt('id', afterId) : query
    }),
  ])

  return generateStudentReport({ ...enrollment, attendance, grades })
}

async function readAllReportRows<T extends { id: string }>(
  readPage: (afterId?: string) => PromiseLike<{
    data: T[] | null
    error: unknown
    count: number | null
  }>,
): Promise<T[]> {
  const rows: T[] = []
  let afterId: string | undefined
  for (;;) {
    const { data, error, count } = await readPage(afterId)
    if (error) throw error
    if (!data || count === null) throw new Error('Could not verify complete report records')
    rows.push(...data)
    // count is the number of remaining rows matching this page's cursor filter.
    // This also works when the project's row cap is smaller than our page size.
    if (data.length === count) return rows
    const lastId = data.at(-1)?.id
    if (!lastId || (afterId && lastId <= afterId)) {
      throw new Error('Could not load complete report records')
    }
    afterId = lastId
  }
}
