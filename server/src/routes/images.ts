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
  deleteManyFromStorage,
  getPublicUrl,
  STORAGE_BUCKET,
} from '../lib/supabase.js'
import { supabase } from '../lib/supabase.js'
import { validateFormat } from '../validators/format.js'
import { validateDimensions } from '../validators/dimensions.js'
import { runValidations } from '../validators/index.js'
import { listImagesQuerySchema, uploadUrlBodySchema, bulkDeleteBodySchema } from '../schemas.js'
import { convertQueue } from '../lib/queue.js'

export const imagesRouter = express.Router()

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

// All possible pipeline output paths for an image. Supabase silently
// ignores entries that don't exist, so this is safe for REJECTED images
// (which never entered the pipeline) too.
function pipelinePathsFor(imageId: string): string[] {
  return [
    `processed/${imageId}/converted.jpg`,
    `processed/${imageId}/compressed.jpg`,
    `processed/${imageId}/thumb.jpg`,
    `processed/${imageId}/mobile.jpg`,
    `processed/${imageId}/tablet.jpg`,
    `processed/${imageId}/web.jpg`,
  ]
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

  // 6. Persist (set processingStatus=QUEUED only when ACCEPTED — REJECTED rows have null)
  await db.image.update({
    where: { id: record.id },
    data: {
      storagePath, publicUrl, status, rejectionReasons: allReasons,
      fileSize, width, height, mimeType, pHash,
      processingStatus: status === ImageStatus.ACCEPTED ? 'QUEUED' : null,
    },
  })

  // 7. Enqueue to the processing pipeline (jobId = imageId prevents duplicate jobs on re-validation)
  if (status === ImageStatus.ACCEPTED) {
    await convertQueue.add(
      record.id,
      { imageId: record.id, storagePath },
      { jobId: record.id },
    )
    console.log(`[validate] ${record.id} ✓ ACCEPTED → enqueued to convert`)
  } else {
    console.log(`[validate] ${record.id} ✗ REJECTED [${allReasons.join(', ')}]`)
  }
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

// GET /api/images/:id/status — pipeline status + variant URLs (polled by client after ACCEPTED)
imagesRouter.get('/:id/status', async (req: express.Request, res: express.Response) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id as string },
      select: {
        status: true,
        rejectionReasons: true,
        processingStatus: true,
        processingError: true,
        compressionRatio: true,
        compressedSize: true,
        variants: {
          select: { type: true, storageUrl: true, width: true, height: true, fileSize: true },
        },
      },
    })
    if (!image) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json(image)
  } catch (err) {
    console.error('GET /api/images/:id/status error:', err)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// POST /api/images/:id/reprocess — idempotent retry for FAILED jobs
// Order: delete storage files → delete DB rows → reset state → re-enqueue
// (prevents orphaned files; jobId=imageId deduplication makes double-clicks safe)
imagesRouter.post('/:id/reprocess', async (req: express.Request, res: express.Response) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, storagePath: true, processingStatus: true },
    })
    if (!image) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (image.processingStatus !== 'FAILED') {
      res.status(400).json({ message: 'Image is not in FAILED state' })
      return
    }

    // 1. Delete all pipeline files (Supabase silently ignores missing entries)
    await deleteManyFromStorage(pipelinePathsFor(image.id))

    // 2. Delete ImageVariant rows
    await db.imageVariant.deleteMany({ where: { imageId: image.id } })

    // 3. Reset processing state
    await db.image.update({
      where: { id: image.id },
      data: {
        processingStatus: 'QUEUED',
        processingError: null,
        compressionRatio: null,
        compressedSize: null,
      },
    })

    // 4. Re-enqueue. BullMQ rejects new jobs sharing a jobId with any prior job
    // (including failed/completed), so we explicitly remove the previous one first.
    // jobId=imageId still gives us deduplication for double-clicked reprocess buttons.
    await convertQueue.remove(image.id).catch(() => undefined)
    await convertQueue.add(
      image.id,
      { imageId: image.id, storagePath: image.storagePath },
      { jobId: image.id },
    )

    console.log(`[reprocess] ${image.id} → re-enqueued to convert`)
    res.json({ enqueued: true })
  } catch (err) {
    console.error('POST /api/images/:id/reprocess error:', err)
    res.status(500).json({ error: 'Reprocess failed' })
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

// DELETE /api/images — bulk delete: single DB query + single Supabase batch call
imagesRouter.delete('/', async (req: express.Request, res: express.Response) => {
  try {
    const parsed = bulkDeleteBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      return
    }

    const { ids } = parsed.data

    const images = await db.image.findMany({
      where: { id: { in: ids } },
      select: { id: true, storagePath: true },
    })

    // Originals + every possible pipeline file for each image, in one Supabase batch
    const allPaths = [
      ...images.map((i) => i.storagePath),
      ...images.flatMap((i) => pipelinePathsFor(i.id)),
    ]

    await Promise.all([
      deleteManyFromStorage(allPaths),
      db.image.deleteMany({ where: { id: { in: ids } } }),
    ])

    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/images error:', err)
    res.status(500).json({ error: 'Bulk delete failed' })
  }
})

// DELETE /api/images/:id — remove DB row + Supabase object (works for any status)
imagesRouter.delete('/:id', async (req: express.Request, res: express.Response) => {
  try {
    const image = await db.image.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, storagePath: true },
    })

    if (!image) {
      res.status(404).json({ error: 'Image not found' })
      return
    }

    // Original + every possible pipeline file (REJECTED images simply have none of the latter)
    const allPaths = [image.storagePath, ...pipelinePathsFor(image.id)]

    await Promise.all([
      deleteManyFromStorage(allPaths),
      db.image.delete({ where: { id: req.params.id as string } }),
    ])

    res.status(204).send()
  } catch (err) {
    console.error('DELETE /api/images error:', err)
    res.status(500).json({ error: 'Delete failed' })
  }
})
