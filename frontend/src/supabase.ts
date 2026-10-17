import { createClient } from '@supabase/supabase-js'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabaseConfigurationError = !supabaseUrl || !supabaseKey
  ? 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env, then restart the frontend.'
  : null

// One browser client owns session persistence and token refresh.
export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

export function getSupabase() {
  if (!supabase) throw new Error(supabaseConfigurationError ?? 'Supabase is not configured')
  return supabase
}

// Signup must not persist a session or sign the user into the dashboard.
// Only the main client above owns the user's explicit login session.
export function createAccount(email: string, password: string) {
  if (!supabaseUrl || !supabaseKey) throw new Error(supabaseConfigurationError ?? 'Supabase is not configured')
  const signupClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      storageKey: 'tevra-signup',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return signupClient.auth.signUp({ email, password })
}
