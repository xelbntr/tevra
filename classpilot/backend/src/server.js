import 'dotenv/config'
import express from 'express'

const app = express()

// Allows handlers to read JSON sent by the frontend.
app.use(express.json())

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', message: 'Learnly backend is running' })
})

const port = process.env.PORT || 5000

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})