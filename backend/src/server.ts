import 'dotenv/config'
import express from 'express'
import cors from 'cors';
import { askAI } from './coach.js';
import { AuthenticationError, requestDashboardData } from './db.js'

const app = express()

// Allows handlers to read JSON sent by the frontend.
app.use(express.json())
app.use(cors())

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Learnly backend is running' })
})

const port = process.env.PORT || 5000

app.post("/submit", async (req, res, next) => {
  console.log("AI Chat data requested")
  try {
    const text = req.body.text

    console.log("AI Chat prompt received: ", text);
    const result = await askAI(text)

    res.json({ result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const match = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Please sign in' })
    return
  }

  try {
    res.json(await requestDashboardData(match[1]))
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    console.error('Dashboard query failed:', error)
    res.status(500).json({ error: 'Could not load dashboard' })
  }
})

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})
