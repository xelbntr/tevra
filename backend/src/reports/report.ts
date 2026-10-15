import { fetchReportData, reportDataSchema } from './data.js'
import type { ReportData, ReportSelection } from './data.js'
import { generateNarrative } from './narrative.js'
import type { ReportNarrative } from './narrative.js'

type AttendanceTotals = Record<'total' | 'present' | 'late' | 'absent' | 'excused', number>

export interface GeneratedReport {
  report: ReportNarrative & {
    grade_summary: {
      graded_assessments: number
      average_percentage: number | null
      basis: 'unweighted_assessment_percentages'
    }
    attendance_totals: AttendanceTotals
  }
  /** Average of recorded assessment percentages, rounded to two decimals. */
  grade: number | null
  /** Recorded attendance rate, with present and late counted as attended. */
  attendance: number | null
}

// Start here: fetch the selected enrollment, then build its report.
export async function generateReport(
  accessToken: string,
  selection: ReportSelection,
): Promise<GeneratedReport | null> {
  const data = await fetchReportData(accessToken, selection)
  if (!data) return null
  return buildStudentReport(data)
}

// Also accepts records directly, after the caller has checked access.
export async function buildStudentReport(input: unknown): Promise<GeneratedReport> {
  const data = reportDataSchema.parse(input)
  const { grade, attendance, attendanceTotals } = calculateMetrics(data)
  const narrative = await generateNarrative(data)

  return {
    report: {
      ...narrative,
      grade_summary: {
        graded_assessments: data.grades.length,
        average_percentage: grade,
        basis: 'unweighted_assessment_percentages',
      },
      attendance_totals: attendanceTotals,
    },
    grade,
    attendance,
  }
}

function calculateMetrics(data: ReportData) {
  const attendanceTotals: AttendanceTotals = {
    total: data.attendance.length,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
  }
  for (const entry of data.attendance) {
    attendanceTotals[entry.status] += 1
  }

  let grade: number | null = null
  if (data.grades.length > 0) {
    let averagePercentage = 0
    for (const entry of data.grades) {
      const percentage = (entry.score / entry.assessment.max_score) * 100
      averagePercentage += percentage / data.grades.length
    }
    // Weights may be incomplete, so this is an unweighted assessment average.
    grade = roundPercentage(averagePercentage)
  }

  let attendance: number | null = null
  if (attendanceTotals.total > 0) {
    const attended = attendanceTotals.present + attendanceTotals.late
    // Excused entries stay in the total; unrecorded dates are not counted.
    attendance = roundPercentage((attended / attendanceTotals.total) * 100)
  }

  return { grade, attendance, attendanceTotals }
}

function roundPercentage(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Report percentage is not finite')
  return Number(value.toFixed(2))
}
