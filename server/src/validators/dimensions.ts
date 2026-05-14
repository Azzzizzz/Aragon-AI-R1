import sharp from 'sharp'
import { RejectionReason } from '@prisma/client'

const MIN_SIDE = 800      // px
const MIN_BYTES = 50_000  // 50 KB

export async function validateDimensions(buffer: Buffer): Promise<{
  reason: RejectionReason | null
  width: number
  height: number
  fileSize: number
}> {
  const { width = 0, height = 0 } = await sharp(buffer).metadata()
  const fileSize = buffer.length

  if (width < MIN_SIDE || height < MIN_SIDE || fileSize < MIN_BYTES) {
    return { reason: RejectionReason.TOO_SMALL, width, height, fileSize }
  }
  return { reason: null, width, height, fileSize }
}
