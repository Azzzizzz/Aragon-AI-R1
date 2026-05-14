import { RejectionReason } from '@prisma/client'
import { validateBlur } from './blur.js'
import { validateDuplicate } from './duplicate.js'
import { validateFace } from './face.js'

import pLimit from 'p-limit'

export interface ValidationResult {
  reasons: RejectionReason[]
  pHash: string
}

// Global limit to ensure only 2 images are processed by the entire server at a time.
const limit = pLimit(2)

export async function runValidations(
  buffer: Buffer,
  width: number,
  height: number
): Promise<ValidationResult> {
  return limit(async () => {
    // Run checks sequentially to keep peak memory low on 512MB instances
    const blurReason = await validateBlur(buffer)
    const duplicateResult = await validateDuplicate(buffer)
    const faceReasons = await validateFace(buffer, width, height)

    const reasons = [
      ...(blurReason ? [blurReason] : []),
      ...(duplicateResult.reason ? [duplicateResult.reason] : []),
      ...faceReasons
    ]

    // Manual GC trigger to clear RAM immediately after heavy processing
    if (global.gc) {
      console.log('🧹 Triggering manual garbage collection...')
      global.gc()
    }

    return { reasons, pHash: duplicateResult.pHash }
  })
}
