import { z } from 'zod'
import { ImageStatus } from '@prisma/client'

export const listImagesQuerySchema = z.object({
  status: z.nativeEnum(ImageStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
})
