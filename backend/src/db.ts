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

const { data, error } = await supabase
  .from('*')
  .select('*')
  .limit(10)

console.log(data)
console.log(error)
