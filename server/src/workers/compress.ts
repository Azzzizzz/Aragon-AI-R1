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
  COMPRESS_QUEUE,
  QUEUE_PREFIX,
  variantsQueue,
  type CompressJobData,
} from '../lib/queue.js'

sharp.cache(false)
sharp.concurrency(1)

async function processJob(job: Job<CompressJobData>): Promise<void> {
  const { imageId, convertedPath } = job.data
  const t0 = Date.now()
  console.log(`[compress] ${imageId} → picked up`)

  const updated = await db.image.updateMany({
    where: { id: imageId },
    data: { processingStatus: 'COMPRESSING', processingError: null },
  })
  if (updated.count === 0) {
    console.log(`[compress] ${imageId} → image was deleted, skipping`)
    return
  }

  const buffer = await downloadFromStorage(convertedPath)

  // Quality 85 — industry sweet spot. Visually near-identical to quality 92 (convert stage),
  // typically 50–70% smaller. mozjpeg disabled for speed; toggle if size matters more than latency.
  const compressed = await sharp(buffer)
    .jpeg({ quality: 85, mozjpeg: false })
    .toBuffer()

  const compressedSize = compressed.length
  const compressionRatio = compressedSize / buffer.length

  const compressedPath = `processed/${imageId}/compressed.jpg`
  await uploadToStorage(compressed, compressedPath, 'image/jpeg', { upsert: true })

  await db.image.update({
    where: { id: imageId },
    data: { compressionRatio, compressedSize },
  })

  await variantsQueue.add(
    imageId,
    { imageId, compressedPath },
    { jobId: imageId },
  )

  const savedPct = Math.round((1 - compressionRatio) * 100)
  const kb = (n: number) => (n / 1024).toFixed(1) + 'KB'
  console.log(
    `[compress] ${imageId} ✓ done in ${Date.now() - t0}ms — q85 ${kb(buffer.length)} → ${kb(compressedSize)} (−${savedPct}% vs converted) → variants`,
  )
}

const worker = new Worker<CompressJobData>(
  COMPRESS_QUEUE,
  async (job) => {
    try {
      await processJob(job)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.image.updateMany({
        where: { id: job.data.imageId },
        data: { processingStatus: 'FAILED', processingError: `compress: ${message}` },
      }).catch(() => undefined)
      throw err
    }
  },
  { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
)

worker.on('failed', (job, err) => {
  console.error(`[compress] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
})

worker.on('ready', () => {
  console.log('[compress] worker ready — listening on aragon:compress (concurrency=2)')
})

const shutdown = async () => {
  console.log('[compress] shutting down…')
  await worker.close()
  await connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
