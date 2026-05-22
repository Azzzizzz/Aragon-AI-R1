import { Redis } from 'ioredis'

const url = process.env.UPSTASH_REDIS_URL
if (!url) throw new Error('Missing UPSTASH_REDIS_URL in environment')

// BullMQ requires maxRetriesPerRequest: null and enableReadyCheck: false for blocking commands
export const connection = new Redis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

connection.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message)
})
