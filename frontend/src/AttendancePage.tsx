import { useEffect, useState } from 'react'
import { AuthenticationError, fetchAttendance, fetchDashboard } from './api'
import type { AttendanceData, AttendanceStatus, DashboardData } from './api'

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

const statusLabels: Record<AttendanceStatus | 'unmarked', string> = {
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
  unmarked: 'Unmarked',
}

export function AttendancePage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [selectedClassId, setSelectedClassId] = useState('')
  const [date, setDate] = useState(localDateValue)
  const [attendance, setAttendance] = useState<AttendanceData | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState('')
  const [attendanceAuthenticationFailed, setAttendanceAuthenticationFailed] = useState(false)
  const [dashboardRetry, setDashboardRetry] = useState(0)
  const [attendanceRetry, setAttendanceRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setDashboardLoading(true)
    setDashboardError('')
    fetchDashboard(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setDashboard(data)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDashboardError(error instanceof Error ? error.message : 'Could not load your classes.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setDashboardLoading(false)
      })
    return () => controller.abort()
  }, [dashboardRetry])

  const classId = dashboard?.classes.some(item => item.id === selectedClassId)
    ? selectedClassId
    : dashboard?.classes[0]?.id || ''

  useEffect(() => {
    if (dashboardLoading || dashboardError || !classId || !validDate(date)) {
      setAttendance(null)
      setAttendanceLoading(false)
      setAttendanceError('')
      setAttendanceAuthenticationFailed(false)
      return
    }

    const controller = new AbortController()
    setAttendance(null)
    setAttendanceError('')
    setAttendanceAuthenticationFailed(false)
    setAttendanceLoading(true)
    fetchAttendance(classId, date, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setAttendance(data)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAttendanceError(error instanceof Error ? error.message : 'Could not load attendance.')
        setAttendanceAuthenticationFailed(error instanceof AuthenticationError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setAttendanceLoading(false)
      })
    return () => controller.abort()
  }, [classId, date, dashboardLoading, dashboardError, attendanceRetry])

  if (dashboardLoading) return <p className="attendance-message" role="status">Loading your classes...</p>
  if (dashboardError) return (
    <section className="attendance-message" role="alert">
      <p>{dashboardError}</p>
      <button className="secondary-button" type="button" onClick={() => setDashboardRetry(value => value + 1)}>Try again</button>
    </section>
  )
  if (!dashboard?.classes.length) return (
    <section className="attendance-empty">
      <span className="attendance-empty-icon" aria-hidden="true">A</span>
      <h2>No classes to take attendance for</h2>
      <p>Your assigned classes will appear here when they are available.</p>
    </section>
  )

  return (
    <div className="attendance-page">
      <section className="attendance-toolbar" aria-label="Attendance filters">
        <label>
          <span>Class</span>
          <select value={classId} onChange={event => setSelectedClassId(event.target.value)}>
            {dashboard.classes.map(item => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.course_code} · {item.academic_year} · Semester {item.semester}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Attendance date</span>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} />
        </label>
      </section>

      {!validDate(date) ? (
        <p className="attendance-message" role="alert">Choose a valid date to view attendance.</p>
      ) : attendanceLoading ? (
        <p className="attendance-message" role="status">Loading attendance...</p>
      ) : attendanceError ? (
        <section className="attendance-message" role="alert">
          <p>{attendanceError}</p>
          {attendanceAuthenticationFailed ? null : (
            <button className="secondary-button" type="button" onClick={() => setAttendanceRetry(value => value + 1)}>Try again</button>
          )}
        </section>
      ) : attendance ? <AttendanceResults data={attendance} /> : null}
    </div>
  )
}

function AttendanceResults({ data }: { data: AttendanceData }) {
  const summary = [
    { label: 'Students', value: data.summary.totalStudents, tone: 'neutral' },
    { label: 'Present', value: data.summary.present, detail: 'Includes late arrivals', tone: 'present' },
    { label: 'Absent', value: data.summary.absent, detail: 'Includes excused absences', tone: 'absent' },
    { label: 'Unmarked', value: data.summary.unmarked, tone: 'unmarked' },
  ]

  return (
    <div className="attendance-results">
      <section className="attendance-overview" aria-label="Attendance summary">
        <div className="attendance-overview-heading">
          <div>
            <p className="attendance-class-kicker">{data.class.course_code} · {data.class.academic_year} · Semester {data.class.semester}</p>
            <h2>{data.class.name}</h2>
          </div>
          <div className="attendance-rate">
            <span>Attendance rate</span>
            <strong>{data.summary.attendanceRate === null ? '—' : `${data.summary.attendanceRate}%`}</strong>
            <small>Present and late, out of all active students</small>
          </div>
        </div>
        <div className="attendance-stat-grid">
          {summary.map(item => (
            <article className={`attendance-stat attendance-stat-${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <small>{item.detail}</small>}
            </article>
          ))}
        </div>
      </section>

      <section className="attendance-recap" aria-label="Attendance status breakdown">
        <div className="attendance-section-heading">
          <div>
            <p className="attendance-section-kicker">DAILY BREAKDOWN</p>
            <h2>Status recap</h2>
          </div>
          <time dateTime={data.date}>{new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
          })}</time>
        </div>
        <div className="attendance-recap-items">
          {(['present', 'late', 'excused', 'absent', 'unmarked'] as const).map(status => (
            <div className={`attendance-recap-item status-${status}`} key={status}>
              <span className="attendance-status-dot" aria-hidden="true" />
              <span>{statusLabels[status]}</span>
              <strong>{data.recap[status]}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="attendance-roster" aria-labelledby="attendance-roster-heading">
        <div className="attendance-section-heading">
          <div>
            <p className="attendance-section-kicker">CLASS LIST</p>
            <h2 id="attendance-roster-heading">Student roster</h2>
          </div>
          <span className="attendance-roster-count">{data.students.length} students</span>
        </div>
        {data.students.length === 0 ? (
          <p className="attendance-roster-empty">There are no active students enrolled in this class.</p>
        ) : (
          <div className="attendance-table-wrap">
            <table>
              <caption className="sr-only">Attendance for {data.class.name} on {data.date}</caption>
              <thead><tr><th scope="col">#</th><th scope="col">Student number</th><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                {data.students.map((student, index) => {
                  const status = student.status ?? 'unmarked'
                  return (
                    <tr key={student.enrollment_id}>
                      <td className="attendance-row-number">{index + 1}</td>
                      <td className="attendance-student-number">{student.student_number}</td>
                      <td className="attendance-student-name">{student.full_name}</td>
                      <td><span className={`attendance-status status-${status}`}>{statusLabels[status]}</span></td>
                      <td className="attendance-notes">{student.notes || <span aria-label="No notes">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="attendance-readonly-note">Attendance records are shown as saved for this date.</p>
    </div>
  )
}
