import { Router } from 'express'
import { AuthenticationError } from '../auth.js'
import { fetchReportData, reportDataSchema, reportInputSchema } from './data.js'
import { renderReportDocument } from './document.js'
import { buildStudentReport, generateReport } from './report.js'

export const reportsRouter = Router()

reportsRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  res.set('Access-Control-Expose-Headers', 'Content-Disposition')
  next()
})

for (const path of ['/', '/download']) {
  reportsRouter.post(path, async (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!token) {
      res.status(401).json({ error: 'Please sign in' })
      return
    }
    const selection = reportInputSchema.safeParse(req.body)
    if (!selection.success) {
      res.status(400).json({ error: 'Provide class_id and student_id as UUIDs' })
      return
    }

    try {
      if (path === '/download') {
        const records = await fetchReportData(token, selection.data)
        if (!records) {
          res.status(404).json({ code: 'ENROLLMENT_NOT_FOUND', error: 'Student enrollment not found' })
          return
        }
        const data = reportDataSchema.parse(records)
        const report = await buildStudentReport(data)
        const document = renderReportDocument(data, report)
        // IDs are validated UUIDs; do not put student names or arbitrary input in headers.
        const filename = `Laporan_Penilaian_${selection.data.student_id}_${selection.data.class_id}.docx`
        res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        res.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        res.send(document)
      } else {
        const report = await generateReport(token, selection.data)
        if (!report) {
          res.status(404).json({ code: 'ENROLLMENT_NOT_FOUND', error: 'Student enrollment not found' })
          return
        }
        res.json(report)
      }
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({ error: 'Invalid or expired session' })
        return
      }
      console.error('Report generation failed:', error)
      res.status(500).json({ error: 'Could not generate the report. Please try again.' })
    }
  })
}
