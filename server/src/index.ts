import './config.js'
import express from 'express'
import cors from 'cors'
import sharp from 'sharp'
import { loadFaceModels } from './lib/faceModel.js'
import { imagesRouter } from './routes/images.js'

// 1. Memory Optimization: Disable sharp cache to prevent OOM on 512MB instances
sharp.cache(false)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json())

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/images', imagesRouter)

// Load face detection model before accepting requests
loadFaceModels()
  .then(() => {
    app.listen(PORT)
  })
  .catch((err) => {
    console.error('Failed to load face detection model:', err)
    process.exit(1)
  })
