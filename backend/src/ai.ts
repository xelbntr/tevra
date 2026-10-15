import 'dotenv/config'
import { Groq } from 'groq-sdk'

// Shared API client; each caller supplies its own prompt and messages.
export const groq = new Groq({
  apiKey: process.env.AI_API_KEY,
})
