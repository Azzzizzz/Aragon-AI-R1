import '../polyfill.js'
import '../config.js'
import { Worker, Job } from 'bullmq'
import sharp from 'sharp'
import { VariantType } from '@prisma/client'
import { connection } from '../lib/redis.js'
import { db } from '../db.js'
import {
  downloadFromStorage,
  uploadToStorage,
  getPublicUrl,
} from '../lib/supabase.js'
import {
  VARIANTS_QUEUE,
  QUEUE_PREFIX,
  type VariantsJobData,
} from '../lib/queue.js'

sharp.cache(false)
sharp.concurrency(1)

type VariantSpec = { type: VariantType; width: number | null; filename: string }

// FULL is intentionally omitted from RESIZED_VARIANTS — it references compressed.jpg
// directly (no re-upload). Generated below in the upsert section.
const RESIZED_VARIANTS: VariantSpec[] = [
  { type: 'THUMBNAIL', width: 300,  filename: 'thumb.jpg'  },
  { type: 'MOBILE',    width: 480,  filename: 'mobile.jpg' },
  { type: 'TABLET',    width: 768,  filename: 'tablet.jpg' },
  { type: 'WEB',       width: 1200, filename: 'web.jpg'    },
]

async function processJob(job: Job<VariantsJobData>): Promise<void> {
  const { imageId, compressedPath } = job.data

  const updated = await db.image.updateMany({
    where: { id: imageId },
    data: { processingStatus: 'GENERATING_VARIANTS', processingError: null },
  })
  if (updated.count === 0) return

  const buffer = await downloadFromStorage(compressedPath)
  const compressedMeta = await sharp(buffer).metadata()

  // Resize four sizes in parallel (FULL is the compressed file itself — no resize)
  const resized = await Promise.all(
    RESIZED_VARIANTS.map(async (spec) => {
      const out = await sharp(buffer)
        .resize(spec.width, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: false })
        .toBuffer()
      const meta = await sharp(out).metadata()
      return { spec, buffer: out, meta }
    }),
  )

  // Upload the 4 resized variants in parallel
  await Promise.all(
    resized.map(({ spec, buffer: outBuffer }) =>
      uploadToStorage(outBuffer, `processed/${imageId}/${spec.filename}`, 'image/jpeg'),
    ),
  )

  // Upsert variant rows — @@unique([imageId, type]) makes retries safe
  await Promise.all([
    ...resized.map(({ spec, buffer: outBuffer, meta }) => {
      const storagePath = `processed/${imageId}/${spec.filename}`
      return db.imageVariant.upsert({
        where: { imageId_type: { imageId, type: spec.type } },
        create: {
          imageId,
          type: spec.type,
          storagePath,
          storageUrl: getPublicUrl(storagePath),
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          fileSize: outBuffer.length,
        },
        update: {
          storagePath,
          storageUrl: getPublicUrl(storagePath),
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          fileSize: outBuffer.length,
        },
      })
    }),
    // FULL → reference to compressed.jpg directly (no re-upload)
    db.imageVariant.upsert({
      where: { imageId_type: { imageId, type: 'FULL' } },
      create: {
        imageId,
        type: 'FULL',
        storagePath: compressedPath,
        storageUrl: getPublicUrl(compressedPath),
        width: compressedMeta.width ?? 0,
        height: compressedMeta.height ?? 0,
        fileSize: buffer.length,
      },
      update: {
        storagePath: compressedPath,
        storageUrl: getPublicUrl(compressedPath),
        width: compressedMeta.width ?? 0,
        height: compressedMeta.height ?? 0,
        fileSize: buffer.length,
      },
    }),
  ])

  await db.image.update({
    where: { id: imageId },
    data: { processingStatus: 'COMPLETE', processingError: null },
  })
}

const worker = new Worker<VariantsJobData>(
  VARIANTS_QUEUE,
  async (job) => {
    try {
      await processJob(job)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.image.updateMany({
        where: { id: job.data.imageId },
        data: { processingStatus: 'FAILED', processingError: `variants: ${message}` },
      }).catch(() => undefined)
      throw err
    }
  },
  { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
)

worker.on('failed', (job, err) => {
  console.error(`[variants] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})

worker.on('ready', () => {
  console.log('[variants] worker ready — listening on aragon:variants (concurrency=2)')
})

const shutdown = async () => {
  console.log('[variants] shutting down…')
  await worker.close()
  await connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
