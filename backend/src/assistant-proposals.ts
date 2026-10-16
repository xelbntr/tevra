import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PreparedEdit } from './assistant-data.js'

function signature(payload: string) {
  return createHmac('sha256', process.env.AI_API_KEY!).update(payload).digest('base64url')
}

export function signProposal(userId: string, proposal: PreparedEdit) {
  const payload = Buffer.from(JSON.stringify({ userId, proposal, expires: Date.now() + 15 * 60_000 })).toString('base64url')
  return `${payload}.${signature(payload)}`
}

// Signed previews work across server restarts and deployment instances without a new table.
export function verifyProposal(token: string, userId: string): PreparedEdit {
  const [payload, supplied, extra] = token.split('.')
  const expected = payload ? signature(payload) : ''
  if (!supplied || extra || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new Error('Invalid change preview. Ask the assistant to prepare it again.')
  }
  const data = JSON.parse(Buffer.from(payload!, 'base64url').toString())
  if (data.userId !== userId || !(data.expires > Date.now())) throw new Error('Change preview expired or belongs to another account. Please prepare it again.')
  return data.proposal
}
