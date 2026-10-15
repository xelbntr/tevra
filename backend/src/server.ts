import 'dotenv/config'
import express from 'express'
import cors from 'cors';
import { askAI } from './coach.js';

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
    const text = req.body.text;

    console.log("AI Chat prompt received: ", text);
    const result = await askAI(text);

    res.json({ result })
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", async (req, res) => {
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
