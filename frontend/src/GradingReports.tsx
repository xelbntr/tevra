import { useEffect, useRef, useState } from 'react'
import { downloadStudentGradeReport, fetchClassStudents, fetchDashboard, fetchStudentReport } from './api'
import type { ClassStudent, DashboardClass, StudentReport } from './api'
import { LoadingSelect, ReportSkeleton } from './LoadingSkeletons'

export function GradingReports() {
  const [retry, setRetry] = useState(0)
  return <GradingReportsRequest key={retry} onRetry={() => setRetry(value => value + 1)} />
}

function GradingReportsRequest({ onRetry }: { onRetry: () => void }) {
  const [classes, setClasses] = useState<DashboardClass[]>([])
  const [classId, setClassId] = useState('')
  const [students, setStudents] = useState<ClassStudent[]>([])
  const [studentId, setStudentId] = useState('')
  const [report, setReport] = useState<StudentReport | null>(null)
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const reportRequest = useRef<AbortController | null>(null)
  const rosterRequest = useRef<AbortController | null>(null)

  useEffect(() => () => reportRequest.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    fetchDashboard(controller.signal)
      .then(data => {
        if (controller.signal.aborted) return
        setClasses(data.classes)
        setClassId(current => current || data.classes[0]?.id || '')
        setLoadingStudents(data.classes.length > 0)
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load your classes.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingClasses(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!classId) return
    const controller = new AbortController()
    rosterRequest.current = controller
    fetchClassStudents(classId, controller.signal)
      .then(rows => {
        if (controller.signal.aborted) return
        setStudents(rows)
        setStudentId(rows[0]?.student_id ?? '')
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load students.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingStudents(false)
      })
    return () => controller.abort()
  }, [classId])

  async function generate() {
    if (!classId || !studentId || loadingStudents || reportRequest.current) return
    const controller = new AbortController()
    reportRequest.current = controller
    setGenerating(true)
    setError('')
    setReport(null)
    try {
      const result = await fetchStudentReport(classId, studentId, controller.signal)
      if (!controller.signal.aborted) setReport(result)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not generate the report.')
    } finally {
      if (!controller.signal.aborted) setGenerating(false)
      if (reportRequest.current === controller) reportRequest.current = null
    }
  }

  async function downloadReport() {
    if (!classId || !studentId || loadingStudents || reportRequest.current) return
    const controller = new AbortController()
    reportRequest.current = controller
    setDownloading(true)
    setError('')
    try {
      await downloadStudentGradeReport(classId, studentId, controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not download the report.')
    } finally {
      if (!controller.signal.aborted) setDownloading(false)
      if (reportRequest.current === controller) reportRequest.current = null
    }
  }

  return (
    <section className="grading-page" aria-label="Grading and reports">
      <div className="grading-intro">
        <h2>Student grading summary and report</h2>
        <p>Select one class and one student. Download creates a Word report from that student’s records in the selected class using the JOINTS template.</p>
      </div>

      <div className="report-selection">
        <label>
          <span>Class</span>
          <LoadingSelect loading={loadingClasses}>
            <select value={classId} aria-busy={loadingClasses} disabled={loadingClasses || classes.length === 0 || generating || downloading} onChange={event => {
              if (reportRequest.current) return
              rosterRequest.current?.abort()
              setStudents([])
              setStudentId('')
              setReport(null)
              setError('')
              setLoadingStudents(Boolean(event.target.value))
              setClassId(event.target.value)
            }}>
              {classes.length === 0 && <option value="">{loadingClasses ? 'Loading classes…' : 'No classes available'}</option>}
              {classes.map(item => <option value={item.id} key={item.id}>{item.name} · {item.course_code}</option>)}
            </select>
          </LoadingSelect>
        </label>
        <label>
          <span>Student</span>
          <LoadingSelect loading={loadingClasses || loadingStudents}>
            <select value={studentId} aria-busy={loadingClasses || loadingStudents} disabled={loadingClasses || loadingStudents || students.length === 0 || generating || downloading} onChange={event => {
              if (reportRequest.current) return
              setStudentId(event.target.value)
              setReport(null)
              setError('')
            }}>
              {students.length === 0 && <option value="">{loadingClasses || loadingStudents ? 'Loading students…' : 'No active students'}</option>}
              {students.map(student => <option value={student.student_id} key={student.student_id}>{student.full_name} · {student.student_number}</option>)}
            </select>
          </LoadingSelect>
        </label>
        <button className="secondary-button" type="button" onClick={generate} disabled={!studentId || generating || downloading || loadingStudents}>
          {generating ? 'Preparing preview...' : 'Preview report'}
        </button>
        <button className="primary-button" type="button" onClick={downloadReport} disabled={!studentId || generating || downloading || loadingStudents}>
          {downloading ? 'Preparing download...' : 'Generate & download .docx'}
        </button>
      </div>

      {error && <div className="error-message report-error" role="alert">
        <p>{error}</p>
        {(classes.length === 0 || (classId && students.length === 0)) && (
          <button className="secondary-button" type="button" onClick={onRetry}>Try again</button>
        )}
      </div>}
      {!error && !loadingClasses && classes.length === 0 && <p className="report-empty">Your account has no classes to report on yet.</p>}
      {!error && !loadingStudents && classId && students.length === 0 && <p className="report-empty">This class has no active students.</p>}
      {generating && <ReportSkeleton />}
      {downloading && <p className="report-empty" role="status">Creating the Word report for this student...</p>}

      {report && <ReportView report={report} />}
    </section>
  )
}

function ReportView({ report }: { report: StudentReport }) {
  const { report: details } = report
  return (
    <div className="student-report" aria-live="polite">
      <div className="report-metrics">
        <article><span>Recorded grade average</span><strong>{formatPercent(report.grade)}</strong><small>{details.grade_summary.graded_assessments} graded assessments</small></article>
        <article><span>Recorded attendance</span><strong>{formatPercent(report.attendance)}</strong><small>{details.attendance_totals.total} attendance entries</small></article>
        <article><span>Attendance counts</span><strong>{details.attendance_totals.present + details.attendance_totals.late} attended</strong><small>{details.attendance_totals.absent} absent · {details.attendance_totals.excused} excused</small></article>
      </div>
      <article className="report-section">
        <h2>{details.title}</h2>
        <h3>Academic summary</h3><p>{details.academic_summary}</p>
        <h3>Attendance summary</h3><p>{details.attendance_summary}</p>
      </article>
      <div className="report-columns">
        <ReportList title="Strengths" items={details.strengths} empty="No specific strengths were supported by the available records." />
        <ReportList title="Areas for support" items={details.areas_for_support} empty="No specific support needs were established by the available records." />
        <ReportList title="Suggested next steps" items={details.recommended_next_steps} empty="No next steps were suggested." />
      </div>
      {details.data_limitations.length > 0 && <ReportList title="Data limitations" items={details.data_limitations} />}
      <p className="report-disclaimer">AI-written sections are drafts for teacher review. Grade and attendance percentages are calculated from recorded entries.</p>
    </div>
  )
}

function ReportList({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <article className="report-section report-list">
      <h3>{title}</h3>
      {items.length ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{empty}</p>}
    </article>
  )
}

function formatPercent(value: number | null) {
  return value === null ? 'No data' : `${value.toFixed(2)}%`
}
