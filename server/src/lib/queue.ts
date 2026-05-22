import { Queue, JobsOptions } from 'bullmq'
import { connection } from './redis.js'

// BullMQ disallows ":" inside queue names — namespacing is achieved via the
// `prefix` option, which becomes the Redis key prefix. Final keys look like
// "aragon:convert:*", "aragon:compress:*", "aragon:variants:*".
export const QUEUE_PREFIX = 'aragon'

export const CONVERT_QUEUE  = 'convert'
export const COMPRESS_QUEUE = 'compress'
export const VARIANTS_QUEUE = 'variants'

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
}

const baseOpts = { connection, prefix: QUEUE_PREFIX, defaultJobOptions } as const

export type ConvertJobData  = { imageId: string; storagePath: string }
export type CompressJobData = { imageId: string; convertedPath: string }
export type VariantsJobData = { imageId: string; compressedPath: string }

export const convertQueue  = new Queue<ConvertJobData>(CONVERT_QUEUE,   baseOpts)
export const compressQueue = new Queue<CompressJobData>(COMPRESS_QUEUE, baseOpts)
export const variantsQueue = new Queue<VariantsJobData>(VARIANTS_QUEUE, baseOpts)
