import { z } from 'zod'
import type { authenticate } from './auth.js'
import { AssistantFailure, AssistantRateLimitError } from './assistant-errors.js'

export const assistantLimits = {
  rounds: 5, toolCalls: 16, toolFailures: 2,
  durationMs: 40_000, modelTimeoutMs: 20_000, completionTokens: 1536,
} as const

const rateResult = z.object({ allowed: z.boolean(), limit: z.literal(6), retry_after_seconds: z.number().int().min(0).max(60) })

export async function checkAssistantRateLimit(context: Awaited<ReturnType<typeof authenticate>>) {
  const { data, error } = await context.db.rpc('consume_assistant_request').abortSignal(AbortSignal.timeout(5000))
  const parsed = rateResult.safeParse(data)
  if (error || !parsed.success || (!parsed.data.allowed && parsed.data.retry_after_seconds < 1)) {
    throw new AssistantFailure('Assistant rate limit check unavailable', { stage: 'rate_limit' })
  }
  if (!parsed.data.allowed) throw new AssistantRateLimitError(parsed.data.retry_after_seconds)
}

// The response deadline also covers database waits. Abort prevents further AI
// calls if a database operation finishes after the request has already timed out.
export async function withAssistantDeadline<T>(run: (signal: AbortSignal) => Promise<T>, durationMs: number = assistantLimits.durationMs): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const failure = new AssistantFailure('Assistant time limit reached', { stage: 'timeout' })
      controller.abort(failure)
      reject(failure)
    }, durationMs)
  })
  try { return await Promise.race([run(controller.signal), timeout]) }
  finally { clearTimeout(timer) }
}
