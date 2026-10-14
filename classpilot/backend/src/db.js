import { createClient } from '@supabase/supabase-js'
import env from 'dotenv'
    
env.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

const { data, error } = await supabase
  .from('*')
  .select('*')
  .limit(10)

console.log(data)
console.log(error)