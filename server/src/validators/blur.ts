import sharp from 'sharp'
import { RejectionReason } from '@prisma/client'

const BLUR_THRESHOLD = 200  // Laplacian variance below this → blurry

export async function validateBlur(buffer: Buffer): Promise<RejectionReason | null> {
  // Resize first for speed (O(65k) vs O(millions) on a full-res image)
  const { data, info } = await sharp(buffer)
    .resize(256, 256, { fit: 'cover' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  let sum = 0
  let sumSq = 0
  let n = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      // Laplacian kernel [0,1,0 / 1,-4,1 / 0,1,0]
      const lap =
        data[i - width] + data[i + width] + data[i - 1] + data[i + 1] - 4 * data[i]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }

  const mean = sum / n
  const variance = sumSq / n - mean * mean

  return variance < BLUR_THRESHOLD ? RejectionReason.BLURRY : null
}
