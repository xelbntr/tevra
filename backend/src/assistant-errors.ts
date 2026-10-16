import { APIError, APIConnectionError, APIConnectionTimeoutError } from 'groq-sdk'
import { appendFile, mkdir } from 'node:fs/promises'

type Details = { stage: string; model?: string; round?: number; tool?: string; messageCount?: number; inputCharacters?: number }

export class AssistantFailure extends Error {
  constructor(message: string, readonly details: Details, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssistantFailure'
  }
}

function redact(value: string): string {
  let result = value
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD/.test(key)) result = result.split(secret).join('[REDACTED]')
  }
  return result.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .slice(0, 8000)
}

function describe(error: unknown, depth = 0): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { message: redact(String(error)) }
  const record = error as Record<string, unknown>
  // Groq's full message/body can contain failed_generation, including student data.
  // Keep the provider's diagnostic message, never its generated text or headers.
  const body = error instanceof APIError && error.error && typeof error.error === 'object'
    ? error.error as Record<string, unknown> : undefined
  const provider = body?.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : body
  const message = provider ? provider.message ?? `Provider returned HTTP ${record.status}` : record.message
  return {
    name: error instanceof Error ? error.constructor.name : 'NonError',
    message: redact(typeof message === 'string' ? message : 'Unknown error'),
    ...(typeof record.status === 'number' ? { status: record.status } : {}),
    ...(typeof (provider?.code ?? record.code) === 'string' ? { code: redact(String(provider?.code ?? record.code)) } : {}),
    ...(typeof provider?.type === 'string' ? { type: redact(provider.type) } : {}),
    ...(error instanceof APIError ? { providerRequestId: error.headers?.get('x-request-id') ?? undefined } : {}),
    ...(error instanceof AssistantFailure ? error.details : {}),
    // Preserve stack frames without repeating a potentially sensitive provider body.
    ...(error instanceof Error ? { stack: redact(error.stack?.split('\n').filter(line => /^\s+at /.test(line)).join('\n') ?? '') } : {}),
    ...(record.cause && depth < 4 ? { cause: describe(record.cause, depth + 1) } : {}),
  }
}

export function logAssistantFailure(error: unknown, context: { requestId: string; route?: string; stage: string; durationMs?: number }) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(), ...context, error: describe(error),
  })
  console.error('Assistant request failed:', entry)
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    const directory = new URL('../logs/', import.meta.url)
    void mkdir(directory, { recursive: true })
      .then(() => appendFile(new URL('assistant-errors.log', directory), entry + '\n'))
      .catch(() => console.error('Could not write the local assistant error log. See the diagnostic entry above.'))
  }
}

export function assistantErrorResponse(error: unknown): { status: number; message: string } {
  const cause = error instanceof AssistantFailure ? error.cause ?? error : error
  if (cause instanceof APIConnectionTimeoutError) return { status: 504, message: 'The AI service took too long to respond. Please try again.' }
  if (cause instanceof APIConnectionError) return { status: 503, message: 'The server could not connect to the AI service. Please try again shortly.' }
  if (cause instanceof APIError) {
    if (cause.status === 429) return { status: 429, message: 'The AI service has reached its usage limit. Please wait a moment and try again.' }
    if (cause.status === 401 || cause.status === 403) return { status: 503, message: 'The AI service is not configured correctly. Please contact the administrator.' }
    if (cause.status === 413) return { status: 422, message: 'This conversation contains too much data. Start a new chat or ask about fewer classes.' }
    if (cause.status && cause.status >= 500) return { status: 503, message: 'The AI service is temporarily unavailable. Please try again shortly.' }
  }
  return { status: 502, message: 'The assistant could not complete this request. Please try again.' }
}
