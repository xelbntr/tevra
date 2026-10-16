import { authenticate } from './auth.js'

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

  const classes = classesResult.data ?? []
  const classIds = classes.map(item => item.id)
  const [averageGrade, attendanceResult, presentResult] = classIds.length ? await Promise.all([
    readAverageGrade(),
    db.from('attendance')
      .select('id, enrollment:enrollments!inner(class_id)', { count: 'exact', head: true })
      .in('enrollment.class_id', classIds),
    db.from('attendance')
      .select('id, enrollment:enrollments!inner(class_id)', { count: 'exact', head: true })
      .in('enrollment.class_id', classIds)
      .in('status', ['present', 'late']),
  ]) : [null, { count: 0, error: null }, { count: 0, error: null }]

  if (attendanceResult.error) throw attendanceResult.error
  if (presentResult.error) throw presentResult.error
  if (attendanceResult.count === null || presentResult.count === null) {
    throw new Error('Could not verify dashboard attendance totals')
  }

  return {
    classes,
    totalStudents: studentsResult.count ?? 0,
    averageGrade,
    attendanceRate: attendanceResult.count
      ? Math.round(presentResult.count / attendanceResult.count * 1000) / 10
      : null,
  }

  // Normalize each recorded grade to a percentage, matching student reports.
  // Cursor pagination prevents the API's row cap from truncating the average.
  async function readAverageGrade(): Promise<number | null> {
    let afterId: string | undefined
    let total = 0
    let recorded = 0
    while (true) {
      const query = db.from('grades')
        .select('id, score, assessment:assessments!inner(max_score), enrollment:enrollments!inner(class_id)', { count: 'exact' })
        .in('enrollment.class_id', classIds)
        .order('id')
        .limit(500)
      const { data, error, count } = await (afterId ? query.gt('id', afterId) : query)
        .returns<{ id: string; score: number; assessment: { max_score: number } }[]>()
      if (error) throw error
      if (!data || count === null) throw new Error('Could not verify dashboard grades')
      for (const grade of data) {
        if (!Number.isFinite(grade.score) || grade.score < 0 || !grade.assessment
          || !Number.isFinite(grade.assessment.max_score) || !(grade.assessment.max_score > 0)) {
          throw new Error('Could not calculate dashboard grades')
        }
        total += grade.score / grade.assessment.max_score * 100
        recorded += 1
      }
      if (!Number.isFinite(total)) throw new Error('Could not calculate dashboard grades')
      if (data.length === count) return recorded ? Math.round(total / recorded * 10) / 10 : null
      const lastId = data.at(-1)?.id
      if (!lastId || (afterId && lastId <= afterId)) throw new Error('Could not load complete dashboard grades')
      afterId = lastId
    }
  }
}
