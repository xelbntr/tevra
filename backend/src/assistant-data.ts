import type { SupabaseClient, PostgrestResponse } from '@supabase/supabase-js'
import { z } from 'zod'

export const editSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grade'), class_id: z.uuid(), record_id: z.uuid(), score: z.number().nonnegative().max(99999999.99).multipleOf(0.01) }).strict(),
  z.object({ kind: z.literal('attendance'), class_id: z.uuid(), enrollment_id: z.uuid(), date: z.iso.date(), status: z.enum(['present', 'late', 'excused', 'absent']) }).strict(),
])
export type Edit = z.infer<typeof editSchema>
type Context = { db: SupabaseClient; user: { id: string } }

// Never silently calculate from a truncated response, even with a lower API row cap.
async function allRows<T extends { id: string }>(read: (after?: string) => PromiseLike<PostgrestResponse<T>>) {
  const rows: T[] = []
  let after: string | undefined
  while (true) {
    const { data, error, count } = await read(after)
    if (error || !data || count === null) throw new Error('Could not read complete records. Please try again.')
    rows.push(...data)
    if (rows.length > 3000) throw new Error('Too many records for one request. Please ask about a smaller class.')
    if (data.length === count) return rows
    const last = data.at(-1)?.id
    if (!last || (after && last <= after)) throw new Error('Could not read complete records.')
    after = last
  }
}

export async function listClasses({ db, user }: Context) {
  return allRows(after => {
    const query = db.from('classes').select('id,name,course_code,academic_year,semester', { count: 'exact' })
      .eq('lecturer_id', user.id).order('id').limit(500)
    return after ? query.gt('id', after) : query
  })
}

async function ownedClass({ db, user }: Context, classId: string) {
  const { data, error } = await db.from('classes').select('id,name,course_code')
    .eq('id', classId).eq('lecturer_id', user.id).maybeSingle()
  if (error || !data) throw new Error('Class not found or unavailable to your account.')
  return data
}

export async function readClass(context: Context, classId: string) {
  z.uuid().parse(classId)
  const selectedClass = await ownedClass(context, classId)
  const { db } = context
  const [students, assessments, grades, attendance] = await Promise.all([
    allRows(after => {
      const q = db.from('enrollments').select('id,status,student:students(id,full_name,student_number)', { count: 'exact' })
        .eq('class_id', classId).order('id').limit(500)
      return (after ? q.gt('id', after) : q)
        .returns<{ id: string; status: string; student: { id: string; full_name: string; student_number: string } | null }[]>()
    }),
    allRows(after => {
      const q = db.from('assessments').select('id,title,assessment_type,max_score,weight,due_date', { count: 'exact' })
        .eq('class_id', classId).order('id').limit(500)
      return after ? q.gt('id', after) : q
    }),
    allRows(after => {
      const q = db.from('grades').select('id,enrollment_id,assessment_id,score,feedback,enrollment:enrollments!inner(class_id)', { count: 'exact' })
        .eq('enrollment.class_id', classId).order('id').limit(500)
      return after ? q.gt('id', after) : q
    }),
    allRows(after => {
      const q = db.from('attendance').select('id,enrollment_id,attendance_date,status,notes,enrollment:enrollments!inner(class_id)', { count: 'exact' })
        .eq('enrollment.class_id', classId).order('id').limit(500)
      return after ? q.gt('id', after) : q
    }),
  ])
  return { class: selectedClass, students, assessments, grades, attendance }
}

// Calculate over complete records on the server; the model only needs aggregates
// for an overview, not thousands of individual rows and repeated UUIDs.
export async function readClassSummary(context: Context, classId: string) {
  const records = await readClass(context, classId)
  const maxima = new Map(records.assessments.map(assessment => [assessment.id, assessment.max_score]))
  let gradeTotal = 0
  let recordedGrades = 0
  for (const grade of records.grades) {
    if (grade.score === null) continue
    const maximum = maxima.get(grade.assessment_id)
    if (!Number.isFinite(grade.score) || grade.score < 0 || typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0) {
      throw new Error('Could not calculate a complete class grade summary.')
    }
    gradeTotal += grade.score / maximum * 100
    recordedGrades++
  }
  if (!Number.isFinite(gradeTotal)) throw new Error('Could not calculate a complete class grade summary.')
  const attendance = { present: 0, late: 0, excused: 0, absent: 0 }
  for (const entry of records.attendance) {
    if (!Object.hasOwn(attendance, entry.status)) throw new Error('Could not calculate a complete class attendance summary.')
    attendance[entry.status as keyof typeof attendance]++
  }
  return {
    class: records.class,
    students: records.students.length,
    assessments: records.assessments.length,
    grades: {
      recorded: recordedGrades,
      average_percentage: recordedGrades ? Math.round(gradeTotal / recordedGrades * 10) / 10 : null,
      basis: 'Unweighted mean of recorded assessment percentages; missing scores are excluded.',
    },
    attendance: {
      ...attendance, recorded: records.attendance.length,
      attendance_rate: records.attendance.length
        ? Math.round((attendance.present + attendance.late) / records.attendance.length * 1000) / 10 : null,
      basis: 'Present and late count as attended; dates with no records are excluded.',
    },
  }
}

function assessmentWords(value: string) {
  const aliases: Record<string, string> = { midterms: 'midterm', finals: 'final', exams: 'exam', tests: 'test', quizzes: 'quiz', assignments: 'assignment', projects: 'project' }
  return value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => aliases[word] ?? word)
}

export function resolveAssessment<T extends { title: string }>(assessments: T[], query: string): T {
  const words = assessmentWords(query)
  if (!words.length) throw new Error('Provide an assessment name.')
  const exact = assessments.filter(row => assessmentWords(row.title).join(' ') === words.join(' '))
  const matches = exact.length ? exact : assessments.filter(row => words.every(word => assessmentWords(row.title).includes(word)))
  if (matches.length !== 1) throw new Error(matches.length
    ? 'More than one assessment matches. Ask which assessment before proposing an edit.'
    : 'No assessment matches. Ask which assessment from this class to use.')
  return matches[0]!
}

export async function readStudentRecords(context: Context, classId: string, student: string, assessment?: string) {
  const records = await readClass(context, classId)
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  const name = normalize(student)
  const exact = records.students.filter(row => normalize(row.student?.full_name ?? '') === name
    || row.student?.student_number?.toLocaleLowerCase() === name)
  // Resolve a unique name from the live roster, never treat a student number as a UUID.
  // Exact matches take priority; shared first names must still be clarified.
  const words = name.split(' ')
  const students = exact.length ? exact : records.students.filter(row => {
    const fullName = normalize(row.student?.full_name ?? '').split(' ')
    return words.every(word => fullName.includes(word))
  })
  if (students.length !== 1) throw new Error(students.length
    ? 'More than one student matches in this class. Ask for the full name or student number before proposing an edit.'
    : 'No student matches in this class. Check the class and ask for the full name or student number.')
  const enrollmentId = students[0]!.id
  const selectedAssessment = assessment ? resolveAssessment(records.assessments, assessment) : undefined
  const grades = records.grades.filter(row => row.enrollment_id === enrollmentId
    && (!selectedAssessment || row.assessment_id === selectedAssessment.id))
  const assessmentIds = new Set(grades.map(row => row.assessment_id))
  return {
    class: records.class, students,
    assessments: selectedAssessment ? [selectedAssessment] : records.assessments.filter(row => assessmentIds.has(row.id)), grades,
    attendance: records.attendance.filter(row => row.enrollment_id === enrollmentId),
  }
}

export async function prepareEdit(context: Context, input: Edit) {
  const edit = editSchema.parse(input)
  const selectedClass = await ownedClass(context, edit.class_id)
  const { db } = context
  let enrollmentId: string
  let before: string | number | null
  let detail: string
  let recordId: string | null
  if (edit.kind === 'grade') {
    const { data, error } = await db.from('grades')
      .select('id,enrollment_id,score,assessment:assessments!inner(title,max_score,class_id)')
      .eq('id', edit.record_id).eq('assessment.class_id', edit.class_id).maybeSingle()
      .returns<{ id: string; enrollment_id: string; score: number; assessment: { title: string; max_score: number; class_id: string } }>()
    if (error || !data) throw new Error('Grade not found. Only existing grades can be edited.')
    if (edit.score > data.assessment.max_score) throw new Error(`Score must be between 0 and ${data.assessment.max_score}.`)
    enrollmentId = data.enrollment_id
    before = data.score
    detail = `${data.assessment.title} (out of ${data.assessment.max_score})`
    recordId = data.id
  } else {
    enrollmentId = edit.enrollment_id
    const { data, error } = await db.from('attendance').select('id,status')
      .eq('enrollment_id', enrollmentId).eq('attendance_date', edit.date).maybeSingle()
    if (error) throw new Error('Could not read attendance.')
    before = data?.status ?? null
    recordId = data?.id ?? null
    detail = edit.date
  }
  const { data: enrollment, error } = await db.from('enrollments')
    .select('id,student:students(full_name,student_number)').eq('id', enrollmentId).eq('class_id', edit.class_id)
    .maybeSingle().returns<{ id: string; student: { full_name: string; student_number: string } }>()
  if (error || !enrollment?.student) throw new Error('Student enrollment not found in this class.')
  return {
    edit, recordId, before, after: edit.kind === 'grade' ? edit.score : edit.status,
    label: `${enrollment.student.full_name} (${enrollment.student.student_number}) · ${selectedClass.name} · ${detail}`,
  }
}

export type PreparedEdit = Awaited<ReturnType<typeof prepareEdit>>

export async function saveEdit(context: Context, proposal: PreparedEdit) {
  const current = await prepareEdit(context, proposal.edit)
  if (current.before !== proposal.before || current.recordId !== proposal.recordId || current.label !== proposal.label) {
    throw new Error('This record changed since the preview. Ask the assistant to prepare it again.')
  }
  const { db } = context
  const edit = current.edit
  const result = edit.kind === 'grade'
    ? await db.from('grades').update({ score: edit.score }).eq('id', edit.record_id).eq('score', current.before!).select('id').maybeSingle()
    : current.recordId
      ? await db.from('attendance').update({ status: edit.status }).eq('id', current.recordId).eq('status', current.before!).select('id').maybeSingle()
      : await db.from('attendance').insert({ enrollment_id: edit.enrollment_id, attendance_date: edit.date, status: edit.status }).select('id').single()
  if (result.error || !result.data) throw new Error('Could not save; the record may have changed. Check the record before retrying.')
  return { message: `Saved: ${current.label} — ${current.before ?? 'Unmarked'} → ${current.after}` }
}
