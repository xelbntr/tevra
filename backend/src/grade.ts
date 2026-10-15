import { authenticate } from './auth.js'

export async function addNewGrade(accessToken: string, input: { enrollment_id: string,  assessment_id: string, score: number, feedback: string | null }) {
  const { db } = await authenticate(accessToken)

  const { data, error } = await db
    .from('grades')
    .insert({
      enrollment_id: input.enrollment_id,
      assessment_id: input.assessment_id,
      score: input.score,
      feedback: input.feedback
    })
    .single()

  if (error) throw error

  return data
}
