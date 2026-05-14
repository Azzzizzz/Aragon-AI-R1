import express from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { ImageStatus } from '@prisma/client'
import heicConvert from 'heic-convert'
import { db } from '../db.js'
import { uploadToStorage, deleteFromStorage } from '../lib/supabase.js'
import { validateFormat } from '../validators/format.js'
import { validateDimensions } from '../validators/dimensions.js'
import { runValidations } from '../validators/index.js'
import { listImagesQuerySchema } from '../schemas.js'

export const imagesRouter = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 }, // 120 MB
})

// POST /api/images — upload + validate a single image
imagesRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' })
      return
    }

    let buffer = req.file.buffer
    const originalFilename = req.file.originalname

    // 1. Magic-byte format check — bail early, don't store invalid files
    const { reason: formatReason, mimeType: detectedMime } = await validateFormat(buffer)
    if (formatReason) {
      res.status(400).json({ error: 'Invalid file format', rejectionReasons: [formatReason] })
      return
    }

    // 2. Convert HEIC → JPEG before any further processing
    let mimeType = detectedMime
    if (mimeType === 'image/heic') {
      buffer = Buffer.from(
        await heicConvert({ buffer, format: 'JPEG', quality: 0.9 })
      )
      mimeType = 'image/jpeg'
    }

    // 3. Dimensions check (cheap, in-memory)
    const { reason: sizeReason, width, height, fileSize } = await validateDimensions(buffer)

    // 4. Upload to Supabase Storage (needed for preview even if rejected)
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const storagePath = `${randomUUID()}.${ext}`
    const publicUrl = await uploadToStorage(buffer, storagePath, mimeType)

    // 5. Run heavy checks in parallel (blur, pHash, face detection)
    const { reasons: heavyReasons, pHash } = await runValidations(buffer, width, height)

    // 6. Aggregate all rejection reasons
    const allReasons = [...(sizeReason ? [sizeReason] : []), ...heavyReasons]
    const status = allReasons.length === 0 ? ImageStatus.ACCEPTED : ImageStatus.REJECTED

    // 7. Persist to DB
    const image = await db.image.create({
      data: {
        filename: originalFilename,
        storagePath,
        publicUrl,
        status,
        rejectionReasons: allReasons,
        fileSize,
        width,
        height,
        mimeType,
        pHash,
      },
    })

    res.status(201).json(image)
  } catch (err) {
    console.error('POST /api/images error:', err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// GET /api/images — list with optional status filter + cursor pagination
imagesRouter.get('/', async (req, res) => {
  try {
    const query = listImagesQuerySchema.safeParse(req.query)
    if (!query.success) {
      res.status(400).json({ error: query.error.flatten() })
      return
    }

    const { status, limit, cursor } = query.data

    const items = await db.image.findMany({
      where: { ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // fetch one extra to determine if there's a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        filename: true,
        status: true,
        rejectionReasons: true,
        publicUrl: true,
        width: true,
        height: true,
        fileSize: true,
        mimeType: true,
        createdAt: true,
      },
    })

    const hasNext = items.length > limit
    if (hasNext) items.pop()

    res.json({ items, nextCursor: hasNext ? items[items.length - 1]?.id : null })
  } catch (err) {
    console.error('GET /api/images error:', err)
    res.status(500).json({ error: 'Failed to fetch images' })
  }
})

// DELETE /api/images/:id — remove DB row + Supabase object
imagesRouter.delete('/:id', async (req, res) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id },
      select: { storagePath: true },
    })

    if (!image) {
      res.status(404).json({ error: 'Image not found' })
      return
    }

    await Promise.all([
      deleteFromStorage(image.storagePath),
      db.image.delete({ where: { id: req.params.id } }),
    ])

    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/images error:', err)
    res.status(500).json({ error: 'Delete failed' })
  }
})
