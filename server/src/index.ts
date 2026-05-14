import './config.js'
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json())

// Health endpoint for cloud monitoring (e.g., Vercel)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Default welcome endpoint for local dev
app.get('/', (_req, res) => {
  res.json({
    message: 'Welcome to the Aragon AI API!',
  })
})

// TODO: mount routes here
// import { resourceRouter } from './routes/resource'
// app.use('/api/resource', resourceRouter)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
