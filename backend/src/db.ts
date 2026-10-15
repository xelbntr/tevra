import { createClient } from '@supabase/supabase-js'
import env from 'dotenv'
    
env.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

export class AuthenticationError extends Error {}

async function authenticate(accessToken: string) {
  const db = createClient(supabaseUrl!, supabaseKey!, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { data: { user }, error: authError } = await db.auth.getUser(accessToken)
  if (authError || !user) {
    throw new AuthenticationError('Invalid or expired session')
  }

  return { db, user }
}

export async function requestDashboardData(accessToken: string) {
  const { db, user } = await authenticate(accessToken)

  const [classesResult, studentsResult] = await Promise.all([
    db.from('classes')
      .select('id, name, course_code, academic_year, semester')
      .eq('lecturer_id', user.id)
      .order('created_at', { ascending: false }),

    db.from('students').select('id', { count: 'exact', head: true }),
  ])

  if (classesResult.error) throw classesResult.error
  if (studentsResult.error) throw studentsResult.error

  return {
    classes: classesResult.data ?? [],
    totalStudents: studentsResult.count ?? 0,
  }
}
