import { Router } from 'express'
import type { PostgrestResponse } from '@supabase/supabase-js'
import { z } from 'zod'
import { authenticate, AuthenticationError } from './auth.js'

const scoreValue = z.number().nonnegative().max(99999999.99).multipleOf(0.01)
const gradeInput = z.object({ enrollment_id: z.uuid(), assessment_id: z.uuid(), score: scoreValue })
const assessmentInput = z.object({
  class_id: z.uuid(), title: z.string().trim().min(1).max(120),
  assessment_type: z.enum(['exam', 'quiz', 'assignment', 'project', 'other']),
  max_score: scoreValue.refine(value => value > 0, 'Maximum score must be positive'),
})
class GradeInputError extends Error {}

// Page through the API's row cap so the gradebook never hides students or scores.
async function allRows<T extends { id: string }>(read: (after?: string) => PromiseLike<PostgrestResponse<T>>) {
  const rows: T[] = []
  let after: string | undefined
  while (true) {
    const { data, error, count } = await read(after)
    if (error) throw error
    if (!data || count === null) throw new Error('Could not load complete grade records')
    rows.push(...data)
    if (data.length === count) return rows
    const last = data.at(-1)?.id
    if (!last || (after && last <= after)) throw new Error('Could not load complete grade records')
    after = last
  }
}

export async function requestGrades(accessToken: string) {
  const { db, user } = await authenticate(accessToken)
  const classes = await allRows(after => {
    const q = db.from('classes').select('id,name,course_code,academic_year,semester', { count: 'exact' })
      .eq('lecturer_id', user.id).order('id').limit(500)
    return after ? q.gt('id', after) : q
  })
  const ids = classes.map(item => item.id)
  if (!ids.length) return { classes, students: [], assessments: [], grades: [] }
  const [enrollments, assessments, grades] = await Promise.all([
    allRows(after => {
      const q = db.from('enrollments').select('id,class_id,student:students(id,full_name,student_number)', { count: 'exact' })
        .in('class_id', ids).eq('status', 'active').order('id').limit(500)
      return (after ? q.gt('id', after) : q)
        .returns<{ id: string; class_id: string; student: { id: string; full_name: string; student_number: string } | null }[]>()
    }),
    allRows(after => {
      const q = db.from('assessments').select('id,class_id,title,assessment_type,max_score', { count: 'exact' })
        .in('class_id', ids).order('id').limit(500)
      return after ? q.gt('id', after) : q
    }),
    allRows(after => {
      const q = db.from('grades').select('id,enrollment_id,assessment_id,score,enrollment:enrollments!inner(class_id,status)', { count: 'exact' })
        .in('enrollment.class_id', ids).eq('enrollment.status', 'active').order('id').limit(500)
      return after ? q.gt('id', after) : q
    }),
  ])
  const students = enrollments.map(row => {
    if (!row.student) throw new Error('Could not load student details')
    return { enrollment_id: row.id, class_id: row.class_id, student_id: row.student.id,
      full_name: row.student.full_name, student_number: row.student.student_number }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name) || a.student_number.localeCompare(b.student_number))
  return { classes, students, assessments,
    grades: grades.map(({ id, enrollment_id, assessment_id, score }) => ({ id, enrollment_id, assessment_id, score })) }
}

export async function saveGrade(accessToken: string, raw: unknown) {
  const input = gradeInput.parse(raw)
  const { db } = await authenticate(accessToken)
  const [enrollment, assessment] = await Promise.all([
    db.from('enrollments').select('id,class_id').eq('id', input.enrollment_id).eq('status', 'active').maybeSingle(),
    db.from('assessments').select('id,class_id,max_score').eq('id', input.assessment_id).maybeSingle(),
  ])
  if (enrollment.error) throw enrollment.error
  if (assessment.error) throw assessment.error
  if (!enrollment.data || !assessment.data || enrollment.data.class_id !== assessment.data.class_id) {
    throw new GradeInputError('Choose a student and assessment from the same available class.')
  }
  if (input.score > assessment.data.max_score) throw new GradeInputError(`Score must be between 0 and ${assessment.data.max_score}.`)
  // The unique key keeps repeat submissions to one score per assessment.
  // Omit feedback so correcting a score preserves existing teacher feedback.
  const { data, error } = await db.from('grades')
    .upsert(input, { onConflict: 'enrollment_id,assessment_id' })
    .select('id,enrollment_id,assessment_id,score').single()
  if (error) throw error
  return data
}

export async function createAssessment(accessToken: string, raw: unknown) {
  const input = assessmentInput.parse(raw)
  const { db } = await authenticate(accessToken)
  const { data, error } = await db.from('assessments').insert(input)
    .select('id,class_id,title,assessment_type,max_score').single()
  if (error) throw error
  return data
}

export const gradesRouter = Router()
gradesRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store')
  const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) { res.status(401).json({ error: 'Please sign in' }); return }
  res.locals.accessToken = token
  next()
})
gradesRouter.get('/', async (_req, res, next) => {
  try { res.json(await requestGrades(res.locals.accessToken)) } catch (error) { next(error) }
})
gradesRouter.post('/', async (req, res, next) => {
  try { res.json(await saveGrade(res.locals.accessToken, req.body)) } catch (error) { next(error) }
})
gradesRouter.post('/assessments', async (req, res, next) => {
  try { res.status(201).json(await createAssessment(res.locals.accessToken, req.body)) } catch (error) { next(error) }
})
gradesRouter.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
  if (error instanceof AuthenticationError) { res.status(401).json({ error: 'Invalid or expired session' }); return }
  if (error instanceof z.ZodError || error instanceof GradeInputError) {
    res.status(400).json({ error: error instanceof z.ZodError ? 'Provide a valid student, assessment and score (up to two decimals).' : error.message })
    return
  }
  console.error('Grades request failed:', error)
  res.status(500).json({ error: 'Could not load or save grades. Please try again.' })
})
