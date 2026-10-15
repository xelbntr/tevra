import type { PostgrestResponse } from '@supabase/supabase-js'
import { z } from 'zod'
import { authenticate } from '../auth.js'

const reportInputSchema = z.object({ class_id: z.uuid(), student_id: z.uuid() })

// Check database records before using them for calculations or AI input.
export const reportDataSchema = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'dropped']),
  student: z.object({ id: z.uuid(), student_number: z.string(), full_name: z.string() }),
  class: z.object({
    id: z.uuid(), name: z.string(), course_code: z.string(),
    academic_year: z.string(), semester: z.string(),
  }),
  attendance: z.array(z.object({
    id: z.uuid(), attendance_date: z.iso.date(),
    status: z.enum(['present', 'absent', 'late', 'excused']),
    notes: z.string().nullable(),
  })),
  grades: z.array(z.object({
    id: z.uuid(), score: z.number().nonnegative(), feedback: z.string().nullable(),
    graded_at: z.iso.datetime({ offset: true }),
    assessment: z.object({
      id: z.uuid(), title: z.string(),
      assessment_type: z.enum(['exam', 'quiz', 'assignment', 'project', 'other']),
      max_score: z.number().positive(), weight: z.number().min(0).max(100).nullable(),
      due_date: z.iso.date().nullable(),
    }),
  })),
})

export type ReportData = z.infer<typeof reportDataSchema>
export type ReportSelection = z.infer<typeof reportInputSchema>

export async function fetchReportData(accessToken: string, input: ReportSelection) {
  const { student_id, class_id } = reportInputSchema.parse(input)
  const { db } = await authenticate(accessToken)

  const { data: enrollment, error } = await db.from('enrollments')
    .select(`
      id, status,
      student:students(id, student_number, full_name),
      class:classes(id, name, course_code, academic_year, semester)
    `)
    .eq('student_id', student_id)
    .eq('class_id', class_id)
    .maybeSingle()

  if (error) throw error
  // Row access policies hide enrollments outside this lecturer's classes.
  if (!enrollment) return null

  const [attendance, grades] = await Promise.all([
    readAllRows((afterId) => {
      const query = db.from('attendance')
        .select('id, attendance_date, status, notes', { count: 'exact' })
        .eq('enrollment_id', enrollment.id)
        .order('id')
        .limit(500)
      return afterId ? query.gt('id', afterId) : query
    }),
    readAllRows((afterId) => {
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

  return { ...enrollment, attendance, grades }
}

// Fetch another page after the last ID until every matching row is loaded.
// T keeps the attendance/grade row type supplied by each query.
async function readAllRows<T extends { id: string }>(
  readPage: (afterId?: string) => PromiseLike<PostgrestResponse<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let afterId: string | undefined

  while (true) {
    const { data, error, count } = await readPage(afterId)
    if (error) throw error
    if (!data || count === null) throw new Error('Could not verify complete report records')

    rows.push(...data)
    // Count includes only rows after this cursor, even when the server caps a page.
    if (data.length === count) return rows

    const lastId = data.at(-1)?.id
    if (!lastId || (afterId && lastId <= afterId)) {
      throw new Error('Could not load complete report records')
    }
    afterId = lastId
  }
}
