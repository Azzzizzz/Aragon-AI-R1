import '../polyfill.js'
import '../config.js'
import { Worker, Job } from 'bullmq'
import sharp from 'sharp'
import { connection } from '../lib/redis.js'
import { db } from '../db.js'
import {
  downloadFromStorage,
  uploadToStorage,
} from '../lib/supabase.js'
import {
  CONVERT_QUEUE,
  QUEUE_PREFIX,
  compressQueue,
  type ConvertJobData,
} from '../lib/queue.js'

// Conservative concurrency: HEIC/JPEG re-encoding is CPU-heavy.
// One image at a time per worker process; scale by running more processes.
sharp.cache(false)
sharp.concurrency(1)

async function processJob(job: Job<ConvertJobData>): Promise<void> {
  const { imageId, storagePath } = job.data

  // Mark stage start (overwrites FAILED on retry — keeps DB in sync with worker reality)
  const updated = await db.image.updateMany({
    where: { id: imageId },
    data: { processingStatus: 'CONVERTING', processingError: null },
  })
  if (updated.count === 0) {
    // Image was deleted while job was queued — nothing to do
    return
  }

  const buffer = await downloadFromStorage(storagePath)

  // Normalize: re-encode at quality 92, strip EXIF (sharp default), convert to sRGB pipeline.
  // This produces a clean canonical JPEG that every downstream stage builds on.
  const converted = await sharp(buffer)
    .toColorspace('srgb')
    .jpeg({ quality: 92, mozjpeg: false })
    .toBuffer()

  const convertedPath = `processed/${imageId}/converted.jpg`
  await uploadToStorage(converted, convertedPath, 'image/jpeg')

  await compressQueue.add(
    imageId,
    { imageId, convertedPath },
    { jobId: imageId },
  )
}

const worker = new Worker<ConvertJobData>(
  CONVERT_QUEUE,
  async (job) => {
    try {
      await processJob(job)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.image.updateMany({
        where: { id: job.data.imageId },
        data: { processingStatus: 'FAILED', processingError: `convert: ${message}` },
      }).catch(() => undefined)
      throw err
    }
  },
  { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
)

worker.on('failed', (job, err) => {
  console.error(`[convert] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})

worker.on('ready', () => {
  console.log('[convert] worker ready — listening on aragon:convert (concurrency=1)')
})

const shutdown = async () => {
  console.log('[convert] shutting down…')
  await worker.close()
  await connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
