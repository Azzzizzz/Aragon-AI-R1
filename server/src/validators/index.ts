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
const limit = pLimit(4)

export async function runValidations(buffer: Buffer): Promise<ValidationResult> {
  return limit(async () => {
    // Blur + duplicate run in parallel (both cheap: CPU hash + DB query)
    const [blurReason, duplicateResult] = await Promise.all([
      validateBlur(buffer),
      validateDuplicate(buffer),
    ])

    // Skip face detection (expensive ~1.5s) if already rejected
    if (blurReason || duplicateResult.reason) {
      ;(global as typeof globalThis & { gc?: () => void }).gc?.()
      return {
        reasons: [
          ...(blurReason ? [blurReason] : []),
          ...(duplicateResult.reason ? [duplicateResult.reason] : []),
        ],
        pHash: duplicateResult.pHash,
      }
    }

    const faceReasons = await validateFace(buffer)

    ;(global as typeof globalThis & { gc?: () => void }).gc?.()
    return { reasons: faceReasons, pHash: duplicateResult.pHash }
  })
}
