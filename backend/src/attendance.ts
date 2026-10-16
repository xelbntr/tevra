import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthenticationError } from './auth.js'

const attendanceQuery = z.object({ class_id: z.uuid(), date: z.iso.date() })
const rosterQuery = z.object({ class_id: z.uuid() })

type AttendanceStatus = 'present' | 'late' | 'excused' | 'absent'
type Enrollment = {
  id: string
  student: { id: string, full_name: string, student_number: string } | null
  attendance: { status: AttendanceStatus, notes: string | null }[]
}

export async function requestAttendanceData(
  accessToken: string,
  input: { class_id: string, date: string },
) {
  const { class_id, date } = attendanceQuery.parse(input)
  const { db, user } = await authenticate(accessToken)

  // Both reads are protected by RLS and can run concurrently. Check class access
  // before returning any roster data, including for classes with no students.
  const [classResult, rosterResult] = await Promise.all([
    db.from('classes')
      .select('id, name, course_code, academic_year, semester')
      .eq('id', class_id)
      .eq('lecturer_id', user.id)
      .maybeSingle(),

    // A left join keeps students who have no attendance record on this date.
    db.from('enrollments')
      .select('id, student:students(id, full_name, student_number), attendance(status, notes)', { count: 'exact' })
      .eq('class_id', class_id)
      .eq('status', 'active')
      .eq('attendance.attendance_date', date)
      .order('id')
      .returns<Enrollment[]>(),
  ])

  const { data: selectedClass, error: classError } = classResult
  if (classError) throw classError
  if (!selectedClass) return null
  const { data, error, count } = rosterResult

  if (error) throw error
  // Never show misleading totals if the database caps the roster response.
  if (!data || count !== data.length) throw new Error('Could not load the complete class roster')

  const recap = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 }
  const students = data.map(enrollment => {
    if (!enrollment.student) throw new Error('Could not load student details')
    const record = enrollment.attendance[0]
    const status = record?.status ?? null
    recap[status ?? 'unmarked'] += 1

    return {
      enrollment_id: enrollment.id,
      student_id: enrollment.student.id,
      student_number: enrollment.student.student_number,
      full_name: enrollment.student.full_name,
      status,
      notes: record?.notes ?? null,
    }
  })
  students.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.student_id.localeCompare(b.student_id))

  const present = recap.present + recap.late
  const recorded = students.length - recap.unmarked

  return {
    class: selectedClass,
    date,
    students,
    summary: {
      totalStudents: students.length,
      present,
      absent: recap.absent + recap.excused,
      unmarked: recap.unmarked,
      attendanceRate: recorded ? Math.round(present / students.length * 100) : null,
    },
    recap,
  }
}

export const attendanceRouter = Router()

// The reports dropdown needs names and IDs, without attendance joins or totals.
export async function requestClassRoster(accessToken: string, classId: string) {
  const { class_id } = rosterQuery.parse({ class_id: classId })
  const { db, user } = await authenticate(accessToken)
  const [classResult, rosterResult] = await Promise.all([
    db.from('classes').select('id').eq('id', class_id).eq('lecturer_id', user.id).maybeSingle(),
    db.from('enrollments')
      .select('student:students(id, full_name, student_number)', { count: 'exact' })
      .eq('class_id', class_id).eq('status', 'active')
      .returns<{ student: { id: string; full_name: string; student_number: string } | null }[]>(),
  ])
  if (classResult.error) throw classResult.error
  if (!classResult.data) return null
  const { data, error, count } = rosterResult
  if (error) throw error
  if (!data || count !== data.length) throw new Error('Could not load the complete class roster')
  const students = data.map(({ student }) => {
    if (!student) throw new Error('Could not load student details')
    return { student_id: student.id, full_name: student.full_name, student_number: student.student_number }
  })
  students.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.student_id.localeCompare(b.student_id))
  return { students }
}

attendanceRouter.get('/roster', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) { res.status(401).json({ error: 'Please sign in' }); return }
  const query = rosterQuery.safeParse(req.query)
  if (!query.success) { res.status(400).json({ error: 'Provide class_id as a UUID' }); return }
  try {
    const roster = await requestClassRoster(token, query.data.class_id)
    if (!roster) { res.status(404).json({ error: 'Class not found' }); return }
    res.json(roster)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    console.error('Class roster query failed:', error)
    res.status(500).json({ error: 'Could not load students' })
  }
})

attendanceRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) {
    res.status(401).json({ error: 'Please sign in' })
    return
  }

  const query = attendanceQuery.safeParse(req.query)
  if (!query.success) {
    res.status(400).json({ error: 'Provide class_id as a UUID and date as YYYY-MM-DD' })
    return
  }

  try {
    const attendance = await requestAttendanceData(token, query.data)
    if (!attendance) {
      res.status(404).json({ error: 'Class not found' })
      return
    }
    res.json(attendance)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    console.error('Attendance query failed:', error)
    res.status(500).json({ error: 'Could not load attendance' })
  }
})
