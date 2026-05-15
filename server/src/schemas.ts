import { z } from 'zod'
import { ImageStatus } from '@prisma/client'

export const listImagesQuerySchema = z.object({
  status: z.nativeEnum(ImageStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
})

export const uploadUrlBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/heif']),
})

export const bulkDeleteBodySchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(200),
})
