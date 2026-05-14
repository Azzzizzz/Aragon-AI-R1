import { RejectionReason } from '@prisma/client'
import { validateBlur } from './blur.js'
import { validateDuplicate } from './duplicate.js'
import { validateFace } from './face.js'

export interface ValidationResult {
  reasons: RejectionReason[]
  pHash: string
}

// Runs blur, duplicate, and face checks in parallel.
// Format and dimensions are checked earlier in the route handler (cheap, bail-early).
export async function runValidations(
  buffer: Buffer,
  width: number,
  height: number
): Promise<ValidationResult> {
  const [blurReason, duplicateResult, faceReasons] = await Promise.all([
    validateBlur(buffer),
    validateDuplicate(buffer),
    validateFace(buffer, width, height),
  ])

  const reasons = [blurReason, duplicateResult.reason, ...faceReasons].filter(
    (r): r is RejectionReason => r !== null
  )

  return { reasons, pHash: duplicateResult.pHash }
}
