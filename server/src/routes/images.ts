import express from 'express'
import { randomUUID } from 'crypto'
import { ImageStatus } from '@prisma/client'
// @ts-expect-error - heic-convert does not have type definitions
import heicConvert from 'heic-convert'
import { db } from '../db.js'
import {
  createSignedUploadUrl,
  downloadFromStorage,
  uploadToStorage,
  deleteFromStorage,
  getPublicUrl,
  STORAGE_BUCKET,
} from '../lib/supabase.js'
import { supabase } from '../lib/supabase.js'
import { validateFormat } from '../validators/format.js'
import { validateDimensions } from '../validators/dimensions.js'
import { runValidations } from '../validators/index.js'
import { listImagesQuerySchema, uploadUrlBodySchema } from '../schemas.js'

export const imagesRouter = express.Router()

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

// Lazily delete PENDING_UPLOAD rows (+ their storage objects) older than 30 min.
// Called at the start of every upload-url request to self-heal without a cron job.
async function cleanupStalePending(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)
  const stale = await db.image.findMany({
    where: { status: ImageStatus.PENDING_UPLOAD, createdAt: { lt: cutoff } },
    select: { id: true, storagePath: true },
  })
  if (stale.length === 0) return
  await supabase.storage.from(STORAGE_BUCKET).remove(stale.map((r) => r.storagePath))
  await db.image.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })
}

// POST /api/images/upload-url — issue a pre-signed upload URL + create PENDING record
imagesRouter.post('/upload-url', async (req: express.Request, res: express.Response) => {
  try {
    const parsed = uploadUrlBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() })
      return
    }

    await cleanupStalePending()

    const { filename, mimeType } = parsed.data
    const ext = MIME_TO_EXT[mimeType] ?? 'jpg'
    const storagePath = `${randomUUID()}.${ext}`
    const publicUrl = getPublicUrl(storagePath)

    const [uploadUrl, image] = await Promise.all([
      createSignedUploadUrl(storagePath),
      db.image.create({
        data: { filename, storagePath, publicUrl, status: ImageStatus.PENDING_UPLOAD },
      }),
    ])

    res.status(201).json({ uploadUrl, storagePath, id: image.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('POST /api/images/upload-url error:', message)
    res.status(500).json({ error: message })
  }
})

// POST /api/images/:id/validate — download from storage, validate, update DB record
imagesRouter.post('/:id/validate', async (req: express.Request, res: express.Response) => {
  try {
    const record = await db.image.findUnique({
      where: { id: req.params.id as string, status: ImageStatus.PENDING_UPLOAD },
    })
    if (!record) {
      res.status(404).json({ error: 'Upload record not found or already processed' })
      return
    }

    // Download bytes — if the client never actually PUT to Supabase this will throw
    let buffer: Buffer
    try {
      buffer = await downloadFromStorage(record.storagePath)
    } catch {
      await db.image.delete({ where: { id: record.id } })
      res.status(400).json({ error: 'File not found in storage — upload may have failed' })
      return
    }

    // 1. Magic-byte format check — bail early for invalid files
    const { reason: formatReason, mimeType: detectedMime } = await validateFormat(buffer)
    if (formatReason) {
      await Promise.all([
        deleteFromStorage(record.storagePath),
        db.image.delete({ where: { id: record.id } }),
      ])
      res.status(400).json({ error: 'Invalid file format', rejectionReasons: [formatReason] })
      return
    }

    // 2. Convert HEIC → JPEG: re-upload as JPEG, delete original HEIC
    let mimeType = detectedMime
    let storagePath = record.storagePath
    let publicUrl = record.publicUrl

    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const jpegBuffer = Buffer.from(
        await heicConvert({ buffer, format: 'JPEG', quality: 0.9 })
      )
      const jpegPath = storagePath.replace(/\.(heic|heif)$/i, '.jpg')
      await uploadToStorage(jpegBuffer, jpegPath, 'image/jpeg')
      await deleteFromStorage(storagePath)
      buffer = jpegBuffer
      mimeType = 'image/jpeg'
      storagePath = jpegPath
      publicUrl = getPublicUrl(jpegPath)
    }

    // 3. Dimensions check
    const { reason: sizeReason, width, height, fileSize } = await validateDimensions(buffer)

    // 4. Heavy checks (blur, duplicate, face detection) — serialised via pLimit(1)
    const { reasons: heavyReasons, pHash } = await runValidations(buffer, width ?? 0, height ?? 0)

    // 5. Aggregate + determine status
    const allReasons = [...(sizeReason ? [sizeReason] : []), ...heavyReasons]
    const status = allReasons.length === 0 ? ImageStatus.ACCEPTED : ImageStatus.REJECTED

    // 6. Persist result (storage object kept regardless of status for preview)
    const image = await db.image.update({
      where: { id: record.id },
      data: {
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
    const message = err instanceof Error ? err.message : String(err)
    console.error('POST /api/images/:id/validate error:', message)
    res.status(500).json({ error: message })
  }
})

// GET /api/images — list with optional status filter + cursor pagination
imagesRouter.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const query = listImagesQuerySchema.safeParse(req.query)
    if (!query.success) {
      res.status(400).json({ error: query.error.flatten() })
      return
    }

    const { status, limit, cursor } = query.data

    const items = await db.image.findMany({
      where: {
        // When no status filter is applied, hide PENDING_UPLOAD rows from the UI
        ...(status ? { status } : { status: { not: ImageStatus.PENDING_UPLOAD } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
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

// DELETE /api/images/:id — remove DB row + Supabase object (works for any status)
imagesRouter.delete('/:id', async (req: express.Request, res: express.Response) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id as string },
      select: { storagePath: true },
    })

    if (!image) {
      res.status(404).json({ error: 'Image not found' })
      return
    }

    await Promise.all([
      deleteFromStorage(image.storagePath),
      db.image.delete({ where: { id: req.params.id as string } }),
    ])

    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/images error:', err)
    res.status(500).json({ error: 'Delete failed' })
  }
})
