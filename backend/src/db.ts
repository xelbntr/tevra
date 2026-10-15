import { createClient } from '@supabase/supabase-js'
import env from 'dotenv'
    
env.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)

export async function requestDashboardData(){
  
}

export async function loginWithEmail(email: string, password: string) {
  console.log("User logging in with email:", email);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw new Error(`Login failed: ${error.message}`)
  }
}

/*
const { data, error } = await supabase
  .from('*')
  .select('*')
  .limit(10)

console.log(data)
console.log(error)
*/
