import './polyfill.js'
import './config.js'
import express from 'express'
import cors from 'cors'
import sharp from 'sharp'
import { loadFaceModels } from './lib/faceModel.js'
import { imagesRouter } from './routes/images.js'

// 1. Memory Optimization: Disable sharp cache and limit concurrency to prevent OOM on 512MB instances
sharp.cache(false)
sharp.concurrency(1)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/images', imagesRouter)

// Load face detection model before accepting requests
loadFaceModels()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to load face detection model:', err)
    process.exit(1)
  })
