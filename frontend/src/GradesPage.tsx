import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createAssessment, fetchGrades, saveGrade } from './api'
import type { Assessment, GradesData, GradeStudent } from './api'
import { GradesSkeleton } from './LoadingSkeletons'
import './GradesPage.css'

export function GradesPage({ revision = 0, onRecordsChanged }: { revision?: number; onRecordsChanged: () => void }) {
  const [data, setData] = useState<GradesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [classId, setClassId] = useState('')
  const [filter, setFilter] = useState('')
  const [entering, setEntering] = useState(false)
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState('')
  const [formClassId, setFormClassId] = useState('')
  const [assessmentId, setAssessmentId] = useState('')
  const [score, setScore] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingAssessment, setAddingAssessment] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchGrades(controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setError('') }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load grades.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, retry])

  const selectedClassId = data?.classes.some(item => item.id === classId) ? classId : data?.classes[0]?.id || ''
  const selectedClass = data?.classes.find(item => item.id === selectedClassId)
  const assessments = data?.assessments.filter(item => item.class_id === selectedClassId) || []
  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const roster = data?.students.filter(item => item.class_id === selectedClassId
    && `${item.full_name} ${item.student_number}`.toLocaleLowerCase().includes(normalizedFilter)) || []
  const gradeMap = new Map(data?.grades.map(item => [`${item.enrollment_id}:${item.assessment_id}`, item]))
  const memberships = data?.students.filter(item => item.student_id === studentId) || []
  const activeFormClassId = memberships.some(item => item.class_id === formClassId) ? formClassId : memberships[0]?.class_id || ''
  const enrollment = memberships.find(item => item.class_id === activeFormClassId)
  const formAssessments = data?.assessments.filter(item => item.class_id === activeFormClassId) || []
  const assessment = formAssessments.find(item => item.id === assessmentId)
  const existing = enrollment && assessment ? gradeMap.get(`${enrollment.enrollment_id}:${assessment.id}`) : undefined
  const uniqueStudents = [...new Map(data?.students.map(item => [item.student_id, item])).values()]
  const search = query.trim().toLocaleLowerCase()
  const matches = search ? uniqueStudents.filter(item => `${item.full_name} ${item.student_number}`.toLocaleLowerCase().includes(search)) : []

  function openEntry(student?: GradeStudent, item?: Assessment) {
    setEntering(true)
    setAddingAssessment(false)
    setStudentId(student?.student_id || '')
    setFormClassId(student?.class_id || selectedClassId)
    setAssessmentId(item?.id || '')
    setScore(student && item ? String(gradeMap.get(`${student.enrollment_id}:${item.id}`)?.score ?? '') : '')
    setQuery('')
    setError('')
    setNotice('')
  }

  function chooseAssessment(id: string) {
    setAssessmentId(id)
    setScore(enrollment ? String(gradeMap.get(`${enrollment.enrollment_id}:${id}`)?.score ?? '') : '')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assessment || !enrollment || score === '' || busy.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const saved = await saveGrade({ enrollment_id: enrollment.enrollment_id, assessment_id: assessment.id, score: Number(score) })
      setData(current => current && ({ ...current, grades: [...current.grades.filter(item => item.id !== saved.id), saved] }))
      setClassId(activeFormClassId)
      setEntering(false)
      setNotice(`Saved ${saved.score}/${assessment.max_score} for ${enrollment.full_name} · ${assessment.title}.`)
      onRecordsChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save. Check the grade before retrying.')
    } finally { busy.current = false; setSaving(false) }
  }

  function assessmentCreated(item: Assessment) {
    setData(current => current && ({ ...current, assessments: [...current.assessments, item] }))
    if (entering) { setAssessmentId(item.id); setScore('') }
    setAddingAssessment(false)
    setNotice(`${item.title} is ready for scores.`)
    onRecordsChanged()
  }

  return <section className="grades-page" aria-label="Grades">
    <div className="grades-heading">
      <p>{entering ? 'Find a student and record their score.' : 'View your class scores. Select a score to add or edit it.'}</p>
      <button className={entering ? 'secondary-button' : 'primary-button'} type="button" disabled={loading || saving || !data || !data.classes.length}
        onClick={() => entering ? (setEntering(false), setAddingAssessment(false), setError('')) : openEntry()}>
        {entering ? 'Back to grades' : 'Add new score'}
      </button>
    </div>
    {notice && <p className="grades-notice" role="status">{notice}</p>}
    {error && <div className="grades-message error-message" role="alert"><p>{error}</p>
      {!entering && <button className="secondary-button" type="button" onClick={() => { setLoading(true); setError(''); setRetry(value => value + 1) }}>Try again</button>}
    </div>}
    {loading && <GradesSkeleton />}
    {!loading && data?.classes.length === 0 && <p className="grades-message">Your account has no classes yet.</p>}

    {!loading && data && data.classes.length > 0 && !entering && <>
      <div className="grades-card grades-toolbar">
        <label>Class<select value={selectedClassId} onChange={event => { setClassId(event.target.value); setAddingAssessment(false) }}>
          {data.classes.map(item => <option key={item.id} value={item.id}>{item.name} · {item.course_code} · {item.academic_year} / {item.semester}</option>)}
        </select></label>
        <label>Find student<input type="search" placeholder="Name or student number" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <button className="secondary-button" type="button" onClick={() => setAddingAssessment(value => !value)}>{addingAssessment ? 'Cancel' : 'New assessment'}</button>
      </div>
      {addingAssessment && <AssessmentForm key={selectedClassId} classId={selectedClassId} onCreated={assessmentCreated} onCancel={() => setAddingAssessment(false)} />}
      <div className="grades-card grades-book">
        <div className="grades-book-heading"><h2>{selectedClass?.name}</h2><span>{roster.length} students · {assessments.length} assessments</span></div>
        {!assessments.length ? <p className="grades-empty">No assessments yet. Create an assessment to start recording scores.</p>
          : <div className="grades-table-scroll" role="region" aria-label="Class gradebook" tabIndex={0}>
            <table className="grades-table"><caption className="sr-only">Scores for {selectedClass?.name}. A dash means no score has been recorded.</caption>
              <thead><tr><th scope="col">Student</th>{assessments.map(item => <th scope="col" key={item.id}>{item.title}<small>Out of {item.max_score}</small></th>)}</tr></thead>
              <tbody>{roster.map(student => <tr key={student.enrollment_id}>
                <th scope="row">{student.full_name}<small>{student.student_number}</small></th>
                {assessments.map(item => {
                  const grade = gradeMap.get(`${student.enrollment_id}:${item.id}`)
                  return <td key={item.id}><button type="button" className={`grade-cell${grade ? ' is-recorded' : ''}`}
                    aria-label={`${grade ? 'Edit' : 'Add'} ${item.title} score for ${student.full_name} (${student.student_number})`}
                    onClick={() => openEntry(student, item)}>{grade ? <>{grade.score}<small>/ {item.max_score}</small></> : '—'}</button></td>
                })}
              </tr>)}</tbody>
            </table>
          </div>}
        {!roster.length && <p className="grades-empty">{filter ? 'No students match your search.' : 'This class has no active students.'}</p>}
        <p className="grades-footnote">— Ungraded · Scores are shown out of each assessment’s maximum.</p>
      </div>
    </>}

    {!loading && data && entering && <div className="grades-entry">
      {!enrollment ? <>
        <div className="grades-card grades-search">
          <label className="sr-only" htmlFor="grade-student-search">Search student</label>
          <input autoFocus id="grade-student-search" type="search" placeholder="Search student by name or number" value={query} onChange={event => setQuery(event.target.value)} />
          <img src="/grades/search.svg" alt="" />
        </div>
        {search && <div className="grades-card grades-search-results" aria-label="Student search results">
          {matches.map(student => <button type="button" key={student.student_id} onClick={() => {
            setStudentId(student.student_id); setAssessmentId(''); setScore(''); setError('')
          }}><strong>{student.full_name}</strong><span>{student.student_number}</span></button>)}
          {!matches.length && <p>No matching students in your classes. Try a name or student number.</p>}
        </div>}
      </> : <>
        <div className="grades-card grades-student">
          <div><strong>{enrollment.full_name}</strong><span>{enrollment.student_number}</span></div>
          <div className="grades-student-actions"><span className="grades-found">Student found! <img src="/grades/check.svg" alt="" /></span>
            <button type="button" className="grades-text-button" disabled={saving} onClick={() => { setStudentId(''); setQuery(''); setAddingAssessment(false) }}>Change student</button></div>
        </div>
        <form className="grades-card grades-score-form" onSubmit={submit}>
          <h2>{existing ? 'Edit Score' : 'Insert New Score'}</h2>
          <fieldset disabled={saving}>
            <div className="grades-field"><span id="grade-subject-label">Subject / Class</span>
              <div className="grades-subjects" role="group" aria-labelledby="grade-subject-label">{memberships.map(item => {
                const subject = data.classes.find(row => row.id === item.class_id)
                return <button type="button" key={item.class_id} aria-pressed={item.class_id === activeFormClassId}
                  onClick={() => { setFormClassId(item.class_id); setAssessmentId(''); setScore(''); setAddingAssessment(false); setError('') }}>
                  {subject?.name}<small>{subject?.course_code} · {subject?.academic_year} / {subject?.semester}</small>
                </button>
              })}</div>
            </div>
            <div className="grades-assessment-row"><label>Assessment<select required value={assessmentId} onChange={event => chooseAssessment(event.target.value)}>
              <option value="">Select an assessment</option>{formAssessments.map(item => <option key={item.id} value={item.id}>{item.title} · out of {item.max_score}</option>)}
            </select></label><button className="grades-text-button" type="button" onClick={() => setAddingAssessment(value => !value)}>{addingAssessment ? 'Close assessment form' : '+ New assessment'}</button></div>
            {!formAssessments.length && <p className="grades-empty">Create an assessment for this class to continue.</p>}
            {assessment && <div className="grades-field grades-score">
              <label htmlFor="grade-score">Score</label>
              <div className="grades-score-value"><span>0–{assessment.max_score}{existing ? ` · Current score: ${existing.score}` : ''}</span>
                <input required id="grade-score" type="number" min="0" max={assessment.max_score} step="0.01" placeholder="—" value={score} onChange={event => setScore(event.target.value)} /></div>
              <input aria-label="Adjust score" type="range" min="0" max={assessment.max_score} step="0.01" value={score || 0} onChange={event => setScore(event.target.value)} />
              <div className="grades-slider-labels"><span>0</span><span>{assessment.max_score / 2}</span><span>{assessment.max_score}</span></div>
            </div>}
            <div className="grades-form-actions"><button className="secondary-button" type="button" onClick={() => { setEntering(false); setAddingAssessment(false); setError('') }}>Cancel</button>
              <button className="primary-button" type="submit" disabled={!assessment || score === '' || (existing && Number(score) === existing.score)}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Submit Score'}</button></div>
          </fieldset>
        </form>
        {addingAssessment && <AssessmentForm key={activeFormClassId} classId={activeFormClassId} onCreated={assessmentCreated} onCancel={() => setAddingAssessment(false)} />}
      </>}
    </div>}
  </section>
}

function AssessmentForm({ classId, onCreated, onCancel }: { classId: string; onCreated: (item: Assessment) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Assessment['assessment_type']>('quiz')
  const [maximum, setMaximum] = useState('100')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try { onCreated(await createAssessment({ class_id: classId, title: title.trim(), assessment_type: type, max_score: Number(maximum) })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create assessment.') }
    finally { busy.current = false; setSaving(false) }
  }
  return <form className="grades-card grades-assessment-form" onSubmit={submit} aria-label="New assessment">
    <h2>New assessment</h2><fieldset disabled={saving}>
      <label>Title<input autoFocus required maxLength={120} placeholder="e.g. Quiz 2" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Type<select value={type} onChange={event => setType(event.target.value as Assessment['assessment_type'])}>
        {(['quiz', 'exam', 'assignment', 'project', 'other'] as const).map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
      </select></label>
      <label>Maximum score<input required type="number" min="0.01" max="99999999.99" step="0.01" value={maximum} onChange={event => setMaximum(event.target.value)} /></label>
      <div className="grades-form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!title.trim()}>{saving ? 'Creating…' : 'Create assessment'}</button></div>
    </fieldset>{error && <p className="error-message" role="alert">{error}</p>}
  </form>
}
