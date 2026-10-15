import 'dotenv/config'
import express from 'express'
import cors from 'cors';
import { rateLimit } from 'express-rate-limit'
import { askAI } from './coach.js';

const app = express()
const aiChatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false })

// Allows handlers to read JSON sent by the frontend.
app.use(express.json())
app.use(cors())

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Learnly backend is running' })
})

const port = process.env.PORT || 5000

app.post('/api/v1/ai/chat', aiChatLimiter, async (req, res) => {
  try {
    const messages = req.body?.messages
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20
      || messages.some((message: unknown) => {
        if (!message || typeof message !== 'object') return true
        const item = message as Record<string, unknown>
        return !['user', 'assistant'].includes(String(item.role))
          || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 5000
      })
      || messages[messages.length - 1]?.role !== 'user'
      || messages.reduce((total: number, message: { content: string }) => total + message.content.length, 0) > 20_000) {
      res.status(400).json({ error: 'Send a conversation with a recent message of up to 5,000 characters.' })
      return
    }

    const result = await askAI(messages)
    const reply = result.choices[0]?.message?.content
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('The AI returned an empty response')
    res.json({ reply })
  } catch (error) {
    console.error('AI chat request failed:', error)
    res.status(502).json({ error: 'The AI could not respond right now. Please try again.' })
  }
});

app.get("/api/dashboard", async (_req, res) => {
  console.log("Dashboard data requested");

  // placeholder data. replace with actual db query
  const data = {
    totalStudents: 120,
    activeCourses: 8,
  };

  res.json(data);
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})
