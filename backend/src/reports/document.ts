import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import type { ReportData } from './data.js'
import type { GeneratedReport } from './report.js'
import { jointsTemplateBase64 } from './template.js'

const unavailable = 'Tidak tersedia'
const noScore = '—'

/** Render a fresh copy; no user data or mutable ZIP is shared across requests. */
export function renderReportDocument(data: ReportData, result: GeneratedReport, now = new Date()): Buffer {
  const zip = new PizZip(Buffer.from(jointsTemplateBase64, 'base64'))
  const source = zip.file('word/document.xml')?.asText()
  if (!source) throw new Error('Report template is missing its document')
  // The sample weights are not a school grading policy. Keep the table geometry,
  // but remove its example weights from this generated copy only.
  zip.file('word/document.xml', source
    .replace(/(<w:t(?:\s[^>]*)?>)(?:20|10|25|100)%(<\/w:t>)/g, '$1N/A$2')
    .replace('[LOGO SEKOLAH]', '')
    .replace('Dokumen ini merupakan template contoh. Sesuaikan bobot, kriteria, dan komponen penilaian dengan kebijakan sekolah.',
      'Draf untuk tinjauan guru. N/A dan — berarti data atau kebijakan belum tersedia. Nilai bukan nilai akhir; hadir termasuk terlambat, izin tidak membedakan sakit.'))

  const details = result.report
  const slots: Record<string, string> = {
    school_name: unavailable,
    academic_year: data.class.academic_year,
    student_name: data.student.full_name,
    student_number: data.student.student_number,
    class_name: data.class.name,
    semester: data.class.semester,
    subject_name: data.class.course_code,
    teacher_name: unavailable,
    passing_criteria: unavailable,
    report_date: new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' }).format(now),
    homeroom_teacher: unavailable,
    midterm_score: noScore, midterm_weighted: noScore, midterm_note: 'Tidak dibedakan',
    final_exam_score: noScore, final_exam_weighted: noScore, final_exam_note: 'Tidak dibedakan',
    final_grade: noScore, weighted_total: noScore, grade_predicate: unavailable,
    present_count: String(details.attendance_totals.present + details.attendance_totals.late),
    excused_count: String(details.attendance_totals.excused),
    sick_count: noScore,
    absent_count: String(details.attendance_totals.absent),
    attendance_percentage: percent(result.attendance),
    student_strengths: draftList(details.strengths),
    areas_to_improve: draftList(details.areas_for_support),
    teacher_comments: [
      'Draf AI untuk tinjauan guru:', details.academic_summary, details.attendance_summary,
      `Rata-rata persentase penilaian tercatat (tanpa bobot): ${percent(result.grade)}. Bukan nilai akhir.`,
      ...details.data_limitations,
    ].join('\n'),
    recommended_actions: draftList(details.recommended_next_steps),
  }
  for (const type of ['assignment', 'quiz', 'project'] as const) {
    const records = data.grades.filter(row => row.assessment.assessment_type === type)
    const mean = records.length
      ? records.reduce((sum, row) => sum + (row.score / row.assessment.max_score) * 100 / records.length, 0)
      : null
    slots[`${type}_score`] = percent(mean)
    slots[`${type}_weighted`] = noScore
    slots[`${type}_note`] = records.length ? `${records.length} nilai tanpa bobot` : 'Belum tercatat'
  }
  const document = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => { throw new Error('Report template has an unmapped field') },
  })
  document.render(slots)
  return document.toBuffer()
}

function percent(value: number | null): string {
  return value === null ? noScore : `${value.toFixed(2)}%`
}

function draftList(items: string[]): string {
  return items.length ? `Draf AI:\n${items.map(item => `• ${item}`).join('\n')}` : 'Belum didukung oleh catatan yang tersedia.'
}
