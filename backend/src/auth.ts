import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

export class AuthenticationError extends Error {}

// This client only verifies explicitly supplied tokens. Keeping it alive lets
// Supabase reuse its public signing-key cache without sharing user sessions.
const verifier = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

export async function authenticate(accessToken: string) {
  const { data, error: authError } = await verifier.auth.getClaims(accessToken)
  const claims = data?.claims
  if (authError || !claims?.sub || claims.role !== 'authenticated'
    || claims.iss !== `${supabaseUrl!.replace(/\/$/, '')}/auth/v1`
    || !(Array.isArray(claims.aud) ? claims.aud.includes('authenticated') : claims.aud === 'authenticated')) {
    throw new AuthenticationError('Invalid or expired session')
  }
  const { data: userData, error: userError } = await verifier.auth.getUser(accessToken)
  if (userError || userData.user?.id !== claims.sub) {
    throw new AuthenticationError('Invalid or expired session')
  }

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

  return { db, user: { id: userData.user.id } }
}
