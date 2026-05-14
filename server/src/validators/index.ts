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
}
