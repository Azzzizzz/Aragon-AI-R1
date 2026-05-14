import './config.js'
import express from 'express'
import cors from 'cors'
import { loadFaceModels } from './lib/faceModel.js'
import { imagesRouter } from './routes/images.js'

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
    // @ts-ignore - HTMLImageElement is a browser type, but face-api uses it in its signatures
    console.error('Failed to load face detection model:', err)
    process.exit(1)
  })
