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

  return {
    classes: classesResult.data ?? [],
    totalStudents: studentsResult.count ?? 0,
  }
}
