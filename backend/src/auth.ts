import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

export class AuthenticationError extends Error {}

export async function authenticate(accessToken: string) {
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
