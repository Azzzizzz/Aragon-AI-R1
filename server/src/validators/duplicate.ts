import sharp from 'sharp'
import { RejectionReason } from '@prisma/client'
import { db } from '../db.js'

const HASH_SIZE = 8          // 8×8 = 64-bit hash
const HAMMING_THRESHOLD = 10 // bits different → duplicate
const LOOKUP_LIMIT = 1000    // only compare against most recent N images

// Average-hash (aHash): resize → greyscale → compare each pixel to mean
async function computeHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const avg = data.reduce((s, v) => s + v, 0) / data.length

  let bits = ''
  for (let i = 0; i < data.length; i++) bits += data[i] >= avg ? '1' : '0'

  // Pack 64 bits into 16 hex chars
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    dist += xor.toString(2).split('1').length - 1
  }
  return dist
}

export async function validateDuplicate(buffer: Buffer): Promise<{
  reason: RejectionReason | null
  pHash: string
}> {
  const pHash = await computeHash(buffer)

  const existing = await db.image.findMany({
    where: { pHash: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: LOOKUP_LIMIT,
    select: { pHash: true },
  })

  const isDuplicate = existing.some(
    (r) => r.pHash && hammingDistance(pHash, r.pHash) <= HAMMING_THRESHOLD
  )

  return { reason: isDuplicate ? RejectionReason.DUPLICATE : null, pHash }
}
