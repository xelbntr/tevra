import { getSupabase } from './supabase'

export type DashboardClass = {
  id: string
  name: string
  course_code: string
  academic_year: string
  semester: string
}

export type DashboardData = {
  classes: DashboardClass[]
  totalStudents: number
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export async function sendAssistantMessage(text: string, signal?: AbortSignal): Promise<string> {
  const prompt = text.trim()
  if (!prompt) throw new Error('Enter a message for the AI assistant.')
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(
      import.meta.env.VITE_AI_CHAT_URL?.trim() || 'http://localhost:5000/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt }),
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the AI service. Make sure the Learnly backend is running.')
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'The AI could not respond right now. Please try again.'
    throw new Error(message)
  }
  const result = data && typeof data === 'object' && 'result' in data ? data.result : null
  const choices = result && typeof result === 'object' && 'choices' in result ? result.choices : null
  const choice: unknown = Array.isArray(choices) ? choices[0] : null
  const message = choice && typeof choice === 'object' && 'message' in choice ? choice.message : null
  if (!message || typeof message !== 'object' || !('content' in message)
    || typeof message.content !== 'string' || !message.content.trim()) {
    throw new Error('The AI service returned an unexpected response.')
  }
  return message.content
}

export class AuthenticationError extends Error {
  constructor() {
    super('Your session is no longer valid. Please sign out and sign in again.')
    this.name = 'AuthenticationError'
  }
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return Number.isSafeInteger(data.totalStudents) && (data.totalStudents as number) >= 0
    && Array.isArray(data.classes) && data.classes.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return ['id', 'name', 'course_code', 'academic_year', 'semester']
        .every((key) => typeof row[key] === 'string')
    })
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  // Read the current session each time so refreshed tokens are used.
  const { data: { session }, error } = await getSupabase().auth.getSession()
  if (error) throw error
  if (!session) throw new AuthenticationError()
  signal?.throwIfAborted()

  let response: Response
  try {
    response = await fetch(
      import.meta.env.VITE_DASHBOARD_URL?.trim() || 'http://localhost:5000/api/dashboard',
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        signal,
      },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 403) throw new Error('You do not have permission to view this dashboard.')
  if (!response.ok) throw new Error('Could not load the dashboard. Please try again.')

  const data: unknown = await response.json().catch(() => null)
  if (!isDashboardData(data)) {
    throw new Error('The server returned an unexpected dashboard response.')
  }
  return data
}
