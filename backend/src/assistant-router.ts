import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authenticate, AuthenticationError } from './auth.js'
import { askAI, chatSchema } from './coach.js'
import { verifyProposal } from './assistant-proposals.js'
import { saveEdit } from './assistant-data.js'
import { assistantErrorResponse, logAssistantFailure } from './assistant-errors.js'

export const assistantRouter = Router()
assistantRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
assistantRouter.post(['/submit', '/api/assistant/confirm'], async (req, res) => {
  const requestId = randomUUID()
  const started = Date.now()
  res.set('X-Request-ID', requestId)
  const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) { res.status(401).json({ error: 'Please sign in' }); return }
  const confirming = req.path === '/api/assistant/confirm'
  const parsed = (confirming ? z.object({ token: z.string().min(1).max(12000) }).strict() : chatSchema).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Provide a message of 1–5000 characters or a valid change preview.' }); return }
  let stage = 'authentication'
  try {
    const context = await authenticate(token)
    stage = confirming ? 'confirmation' : 'chat'
    if (confirming && 'token' in parsed.data) {
      const proposal = verifyProposal(parsed.data.token, context.user.id)
      res.json(await saveEdit(context, proposal))
    } else {
      res.json(await askAI(chatSchema.parse(parsed.data), context, requestId))
    }
  } catch (error) {
    if (error instanceof AuthenticationError) { res.status(401).json({ error: 'Invalid or expired session' }); return }
    logAssistantFailure(error, { requestId, route: req.path, stage, durationMs: Date.now() - started })
    if (confirming) {
      res.status(409).json({ error: error instanceof Error ? error.message : 'Could not save the change.' })
    } else {
      const failure = assistantErrorResponse(error)
      res.status(failure.status).json({ error: failure.message, requestId })
    }
  }
})
