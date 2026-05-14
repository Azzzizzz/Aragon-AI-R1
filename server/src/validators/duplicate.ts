import sharp from 'sharp'
import { RejectionReason } from '@prisma/client'
import { db } from '../db.js'

const HASH_SIZE = 8          // 8×8 = 64-bit hash
const HAMMING_THRESHOLD = 10 // bits different → duplicate
const LOOKUP_LIMIT = 1000    // only compare against most recent N images

// Average-hash (aHash): resize → greyscale → compare each pixel to mean
async function generateHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]
  }
  const avg = sum / data.length

  let hash = ''
  for (let i = 0; i < data.length; i++) {
    hash += data[i] >= avg ? '1' : '0'
  }
  return hash
}

function hammingDistance(h1: string, h2: string): number {
  let dist = 0
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++
  }
  return dist
}

export async function validateDuplicate(
  buffer: Buffer
): Promise<{ reason: RejectionReason | null; pHash: string }> {
  const pHash = await generateHash(buffer)

  // Check against latest 1000 images (sliding window for performance)
  const existing = await db.image.findMany({
    take: 1000,
    orderBy: { createdAt: 'desc' },
    select: { pHash: true },
  })

  const isDuplicate = existing.some((img) => img.pHash && hammingDistance(img.pHash, pHash) <= HAMMING_THRESHOLD)

  return {
    reason: isDuplicate ? RejectionReason.DUPLICATE : null,
    pHash,
  }
}
