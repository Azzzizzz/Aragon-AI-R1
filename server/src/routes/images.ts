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
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      return
    }

    cleanupStalePending().catch(() => undefined)

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

// Background validation pipeline — called fire-and-forget from POST /:id/validate
async function runValidationPipeline(record: { id: string; storagePath: string; publicUrl: string }): Promise<void> {
  // Download bytes — if client never PUT to Supabase this will throw
  let buffer: Buffer
  try {
    buffer = await downloadFromStorage(record.storagePath)
  } catch {
    await db.image.delete({ where: { id: record.id } })
    return
  }

  // 1. Magic-byte format check
  const { reason: formatReason, mimeType: detectedMime } = await validateFormat(buffer)
  if (formatReason) {
    await Promise.all([
      deleteFromStorage(record.storagePath),
      db.image.delete({ where: { id: record.id } }),
    ])
    return
  }

  // 2. Convert HEIC → JPEG
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

  // 3. Dimensions
  const { reason: sizeReason, width, height, fileSize } = await validateDimensions(buffer)

  // 4. Blur + duplicate (parallel) then face detection (skipped if already rejected)
  const { reasons: heavyReasons, pHash } = await runValidations(buffer)

  // 5. Aggregate
  const allReasons = [...(sizeReason ? [sizeReason] : []), ...heavyReasons]

  // 5b. Duplicate: delete this copy, leave the original in place
  if (allReasons.includes('DUPLICATE')) {
    const original = await db.image.findFirst({
      where: { pHash, id: { not: record.id } },
      orderBy: { createdAt: 'asc' },
    })
    if (original) {
      // Use local storagePath (may differ from record.storagePath after HEIC→JPEG conversion)
      await Promise.all([
        deleteFromStorage(storagePath),
        db.image.delete({ where: { id: record.id } }),
      ])
      return
    }
  }

  const status = allReasons.length === 0 ? ImageStatus.ACCEPTED : ImageStatus.REJECTED

  // 6. Persist
  await db.image.update({
    where: { id: record.id },
    data: { storagePath, publicUrl, status, rejectionReasons: allReasons, fileSize, width, height, mimeType, pHash },
  })
}

// POST /api/images/:id/validate — kick off background validation, return immediately
imagesRouter.post('/:id/validate', async (req: express.Request, res: express.Response) => {
  try {
    const record = await db.image.findUnique({
      where: { id: req.params.id as string, status: ImageStatus.PENDING_UPLOAD },
    })
    if (!record) {
      res.status(404).json({ error: 'Upload record not found or already processed' })
      return
    }

    // Fire-and-forget — client polls GET /:id for the result
    runValidationPipeline(record).catch((err) => {
      console.error('Background validation error:', err instanceof Error ? err.message : String(err))
    })

    res.status(202).json({ id: record.id, status: ImageStatus.PENDING_UPLOAD })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('POST /api/images/:id/validate error:', message)
    res.status(500).json({ error: message })
  }
})

// GET /api/images/:id — single image lookup used by the polling loop
imagesRouter.get('/:id', async (req: express.Request, res: express.Response) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true, filename: true, status: true, rejectionReasons: true,
        publicUrl: true, width: true, height: true, fileSize: true, mimeType: true, createdAt: true,
      },
    })
    if (!image) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json(image)
  } catch (err) {
    console.error('GET /api/images/:id error:', err)
    res.status(500).json({ error: 'Failed to fetch image' })
  }
})

// GET /api/images — list with optional status filter + cursor pagination
imagesRouter.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const query = listImagesQuerySchema.safeParse(req.query)
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? 'Invalid query' })
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
