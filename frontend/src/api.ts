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
