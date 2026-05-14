import { RejectionReason } from '@prisma/client'
import { validateBlur } from './blur.js'
import { validateDuplicate } from './duplicate.js'
import { validateFace } from './face.js'

import pLimit from 'p-limit'

export interface ValidationResult {
  reasons: RejectionReason[]
  pHash: string
}

// Global limit to ensure only 1 image is processed by the entire server at a time.
// This is critical for staying under 512MB RAM with face detection.
const limit = pLimit(1)

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

    return { reasons, pHash: duplicateResult.pHash }
  })
}
