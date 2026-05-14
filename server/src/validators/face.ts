import { RejectionReason } from '@prisma/client'
import { detectFaces } from '../lib/faceModel.js'

const MIN_FACE_RATIO = 0.05  // face must be ≥5% of image area

export async function validateFace(buffer: Buffer): Promise<RejectionReason[]> {
  const { count, largestRatio } = await detectFaces(buffer)
  const reasons: RejectionReason[] = []

  if (count === 0) {
    reasons.push(RejectionReason.NO_FACE)
    return reasons
  }

  if (count > 1) {
    reasons.push(RejectionReason.MULTIPLE_FACES)
    return reasons
  }

  if (largestRatio < MIN_FACE_RATIO) {
    reasons.push(RejectionReason.FACE_TOO_SMALL)
  }

  return reasons
}
