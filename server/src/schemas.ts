import { z } from 'zod'

// Add Zod request schemas here as you build each endpoint.
// Keep schemas colocated here for easy reference during the assessment.

// Example — remove and replace with spec-specific schemas:
// export const createResourceSchema = z.object({
//   title: z.string().min(1, 'Title is required'),
//   description: z.string().optional(),
// })

export const signedUrlSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
})
