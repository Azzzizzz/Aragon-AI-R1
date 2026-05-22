import { Redis } from 'ioredis'

const url = process.env.UPSTASH_REDIS_URL
if (!url) throw new Error('Missing UPSTASH_REDIS_URL in environment')

// Upstash free tier uses optimistic-volatile eviction; BullMQ logs an "IMPORTANT!
// Eviction policy ... should be noeviction" warning to console.log on every
// connection. Our queues stay shallow (jobs are short-lived and removed after
// completion) so the recommendation does not affect correctness. Filtering the
// warning so it does not drown out the operational worker logs.
const originalLog = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Eviction policy')) return
  originalLog(...args)
}

// BullMQ requires maxRetriesPerRequest: null and enableReadyCheck: false for blocking commands
export const connection = new Redis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

connection.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message)
})
