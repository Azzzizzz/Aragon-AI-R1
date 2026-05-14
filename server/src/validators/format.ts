import { fileTypeFromBuffer } from 'file-type'
import { RejectionReason } from '@prisma/client'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/heic'])

export async function validateFormat(
  buffer: Buffer
): Promise<{ reason: RejectionReason | null; mimeType: string }> {
  const type = await fileTypeFromBuffer(buffer)
  if (!type || !ALLOWED.has(type.mime)) {
    return { reason: RejectionReason.INVALID_FORMAT, mimeType: type?.mime ?? 'unknown' }
  }
  return { reason: null, mimeType: type.mime }
}
