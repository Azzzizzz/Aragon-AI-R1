/**
 * Load test for the Round 2 processing pipeline.
 *
 *   npm run loadtest --prefix server -- --count=50 --concurrency=20
 *
 * Drives the full upload → validate → pipeline flow concurrently and reports
 * throughput + latency percentiles per stage. Each upload uses a unique face
 * from client/public/test-images/load-test/ so the Round 1 pHash duplicate
 * detector does not reject them.
 *
 * Idempotent re-runs: at start, any image whose filename matches face-NNN.jpg
 * is deleted (DB + Storage) so the same pool of faces can be uploaded again
 * without DUPLICATE rejections.
 */
import '../src/polyfill.js'
import '../src/config.js'
import { readdirSync, readFileSync, statSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import pLimit from 'p-limit'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_IMAGES_DIR = resolve(__dirname, '../../client/public/test-images/load-test')

// ─── CLI ─────────────────────────────────────────────────────────────────────
function getArg(name: string, def: string): string {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return m ? m.split('=')[1] : def
}
const COUNT = parseInt(getArg('count', '50'), 10)
const CONCURRENCY = parseInt(getArg('concurrency', '20'), 10)
const BASE_URL = getArg('base-url', 'http://localhost:3000')
const IMAGES_DIR = getArg('images-dir', DEFAULT_IMAGES_DIR)
const POLL_INTERVAL_MS = parseInt(getArg('poll', '1000'), 10)
// Per-image polling timeout. Needs headroom proportional to queue depth: with
// convert concurrency=1 processing ~3s/image, the LAST of 50 concurrent uploads
// waits ~150s before its pipeline turn — so 300s default is safe and we still
// catch true stalls (a wedged worker would never finish even at 10 min).
const TIMEOUT_MS = parseInt(getArg('timeout', '300000'), 10)

// ─── Result tracking ─────────────────────────────────────────────────────────
type Outcome = 'COMPLETE' | 'FAILED' | 'REJECTED' | 'TIMEOUT' | 'ERROR'

interface Result {
  filename: string
  imageId?: string
  outcome: Outcome
  tStart: number
  tUploadUrlMs?: number
  tPutMs?: number
  tValidateCallMs?: number
  tValidateToCompleteMs?: number
  endToEndMs?: number
  finalStatus?: string
  processingError?: string
  variantsCount?: number
  compressionRatio?: number | null
  errorMessage?: string
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

interface UploadUrlResponse { uploadUrl: string; storagePath: string; id: string }
interface StatusResponse {
  status: 'PENDING_UPLOAD' | 'ACCEPTED' | 'REJECTED'
  rejectionReasons: string[]
  processingStatus: string | null
  processingError: string | null
  compressionRatio: number | null
  compressedSize: number | null
  variants: Array<{ type: string; storageUrl: string; width: number; height: number; fileSize: number }>
}

// ─── Cleanup previous load test rows ─────────────────────────────────────────
async function cleanupPreviousRun(): Promise<number> {
  // Pull all images (cursor pagination), filter to face-NNN.jpg, bulk delete
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const url = cursor ? `/api/images?limit=100&cursor=${cursor}` : '/api/images?limit=100'
    const page = await api<{ items: Array<{ id: string; filename: string }>; nextCursor: string | null }>(url)
    for (const item of page.items) {
      if (/^face-\d{3}\.jpg$/.test(item.filename)) ids.push(item.id)
    }
    cursor = page.nextCursor
  } while (cursor)

  if (ids.length === 0) return 0

  // Chunk to avoid huge request bodies
  const CHUNK = 50
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const res = await fetch(`${BASE_URL}/api/images`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: chunk }),
    })
    if (!res.ok) throw new Error(`bulk delete failed: HTTP ${res.status}`)
  }
  return ids.length
}

// ─── One image's lifecycle ───────────────────────────────────────────────────
async function runOne(filepath: string): Promise<Result> {
  const filename = basename(filepath)
  const buffer = readFileSync(filepath)
  const result: Result = { filename, outcome: 'ERROR', tStart: Date.now() }

  try {
    // 1. POST /upload-url
    const t1 = Date.now()
    const upload = await api<UploadUrlResponse>('/api/images/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mimeType: 'image/jpeg' }),
    })
    result.imageId = upload.id
    result.tUploadUrlMs = Date.now() - t1

    // 2. PUT bytes to signed URL
    const t2 = Date.now()
    const putRes = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: buffer,
    })
    if (!putRes.ok) throw new Error(`PUT to signed URL failed: HTTP ${putRes.status}`)
    result.tPutMs = Date.now() - t2

    // 3. POST /:id/validate (returns 202 immediately, fire-and-forget)
    const t3 = Date.now()
    await api(`/api/images/${upload.id}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    result.tValidateCallMs = Date.now() - t3

    // 4. Poll /status until COMPLETE / FAILED / timeout
    const pollStart = Date.now()
    while (Date.now() - pollStart < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

      // Validation may have rejected the image → /status returns 404
      const statusRes = await fetch(`${BASE_URL}/api/images/${upload.id}/status`)
      if (statusRes.status === 404) {
        // Round 1 deletes the row on REJECTED/DUPLICATE → treat as a REJECTED outcome
        result.outcome = 'REJECTED'
        result.finalStatus = 'NOT_FOUND_LIKELY_REJECTED'
        result.endToEndMs = Date.now() - result.tStart
        return result
      }
      if (!statusRes.ok) throw new Error(`GET /status → HTTP ${statusRes.status}`)
      const status = (await statusRes.json()) as StatusResponse

      // Validation rejected the image — no pipeline activity will ever happen
      if (status.status === 'REJECTED') {
        result.outcome = 'REJECTED'
        result.finalStatus = `REJECTED:${status.rejectionReasons.join(',')}`
        result.processingError = status.rejectionReasons.join(', ')
        result.endToEndMs = Date.now() - result.tStart
        return result
      }

      if (status.processingStatus === 'COMPLETE') {
        result.outcome = 'COMPLETE'
        result.finalStatus = 'COMPLETE'
        result.variantsCount = status.variants.length
        result.compressionRatio = status.compressionRatio
        result.tValidateToCompleteMs = Date.now() - t3 - (result.tValidateCallMs ?? 0)
        result.endToEndMs = Date.now() - result.tStart
        return result
      }
      if (status.processingStatus === 'FAILED') {
        result.outcome = 'FAILED'
        result.finalStatus = 'FAILED'
        result.processingError = status.processingError ?? undefined
        result.tValidateToCompleteMs = Date.now() - t3 - (result.tValidateCallMs ?? 0)
        result.endToEndMs = Date.now() - result.tStart
        return result
      }
    }

    result.outcome = 'TIMEOUT'
    result.finalStatus = 'TIMEOUT'
    result.endToEndMs = Date.now() - result.tStart
    return result
  } catch (err) {
    result.outcome = 'ERROR'
    result.errorMessage = err instanceof Error ? err.message : String(err)
    result.endToEndMs = Date.now() - result.tStart
    return result
  }
}

// ─── Stats helpers ───────────────────────────────────────────────────────────
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

function fmtMs(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '   —'
  if (ms < 1000) return `${ms.toString().padStart(4)}ms`
  return `${(ms / 1000).toFixed(2).padStart(5)}s`
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Load image pool
  let files: string[]
  try {
    files = readdirSync(IMAGES_DIR)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .map((f) => resolve(IMAGES_DIR, f))
      .filter((p) => statSync(p).isFile())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Image pool unreadable at ${IMAGES_DIR}: ${message}`)
    console.error('Run `npx tsx server/scripts/fetch-test-faces.ts --count=50` first.')
    process.exit(1)
  }

  if (files.length === 0) {
    console.error(`No images in ${IMAGES_DIR}`)
    process.exit(1)
  }
  if (files.length < COUNT) {
    console.warn(`⚠  only ${files.length} images in pool, requested ${COUNT} — will reuse (some uploads may be rejected as DUPLICATE)`)
  }

  // Health check
  try {
    const h = await fetch(`${BASE_URL}/health`)
    if (!h.ok) throw new Error(`HTTP ${h.status}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`API health check failed at ${BASE_URL}: ${message}`)
    console.error('Is `npm run dev` running?')
    process.exit(1)
  }

  // Cleanup previous load test rows so the same pool can be re-uploaded
  console.log('Cleaning up previous load test images…')
  const cleaned = await cleanupPreviousRun()
  console.log(`  removed ${cleaned} prior load test image(s)\n`)

  console.log(`=== ARAGON LOAD TEST ===`)
  console.log(`Base URL:     ${BASE_URL}`)
  console.log(`Image pool:   ${files.length} files in ${IMAGES_DIR}`)
  console.log(`Uploads:      ${COUNT}`)
  console.log(`Concurrency:  ${CONCURRENCY}`)
  console.log(`Timeout:      ${TIMEOUT_MS / 1000}s per image`)
  console.log(``)

  const limit = pLimit(CONCURRENCY)
  const tStart = Date.now()

  let inFlight = 0
  let done = 0
  const tickInterval = setInterval(() => {
    process.stdout.write(`\r[progress] done=${done}/${COUNT}  in-flight=${inFlight}  elapsed=${((Date.now() - tStart) / 1000).toFixed(1)}s   `)
  }, 500)

  const results = await Promise.all(
    Array.from({ length: COUNT }, (_, i) => {
      const filepath = files[i % files.length]!
      return limit(async () => {
        inFlight++
        try {
          return await runOne(filepath)
        } finally {
          inFlight--
          done++
        }
      })
    }),
  )

  clearInterval(tickInterval)
  process.stdout.write('\r' + ' '.repeat(80) + '\r') // clear progress line

  const totalMs = Date.now() - tStart

  // ─── Summary ─────────────────────────────────────────────────────────────
  const byOutcome: Record<Outcome, Result[]> = { COMPLETE: [], FAILED: [], REJECTED: [], TIMEOUT: [], ERROR: [] }
  for (const r of results) byOutcome[r.outcome].push(r)

  const completed = byOutcome.COMPLETE
  const e2eLatencies = completed.map((r) => r.endToEndMs!).filter(Boolean)
  const pipelineLatencies = completed.map((r) => r.tValidateToCompleteMs!).filter(Boolean)
  const compressionRatios = completed.map((r) => r.compressionRatio).filter((r): r is number => r != null)

  console.log(`=== SUMMARY (${(totalMs / 1000).toFixed(1)}s wall clock) ===\n`)

  console.log(`Outcomes:`)
  console.log(`  COMPLETE   ${byOutcome.COMPLETE.length.toString().padStart(3)} / ${COUNT}`)
  console.log(`  REJECTED   ${byOutcome.REJECTED.length.toString().padStart(3)} / ${COUNT}  (validation rejected — DUPLICATE / face-api / etc.)`)
  console.log(`  FAILED     ${byOutcome.FAILED.length.toString().padStart(3)} / ${COUNT}  (pipeline reached FAILED state)`)
  console.log(`  TIMEOUT    ${byOutcome.TIMEOUT.length.toString().padStart(3)} / ${COUNT}`)
  console.log(`  ERROR      ${byOutcome.ERROR.length.toString().padStart(3)} / ${COUNT}  (network / HTTP)`)
  console.log(``)

  if (completed.length > 0) {
    console.log(`End-to-end latency (upload-url call → COMPLETE):`)
    console.log(`  p50: ${fmtMs(percentile(e2eLatencies, 50))}   min: ${fmtMs(Math.min(...e2eLatencies))}`)
    console.log(`  p90: ${fmtMs(percentile(e2eLatencies, 90))}   max: ${fmtMs(Math.max(...e2eLatencies))}`)
    console.log(`  p99: ${fmtMs(percentile(e2eLatencies, 99))}`)
    console.log(``)
    console.log(`Pipeline latency (validate call → COMPLETE):`)
    console.log(`  p50: ${fmtMs(percentile(pipelineLatencies, 50))}`)
    console.log(`  p90: ${fmtMs(percentile(pipelineLatencies, 90))}`)
    console.log(`  p99: ${fmtMs(percentile(pipelineLatencies, 99))}`)
    console.log(``)
    console.log(`Throughput:`)
    console.log(`  ${(completed.length / (totalMs / 1000)).toFixed(2)} img/s end-to-end (${completed.length} succeeded in ${(totalMs / 1000).toFixed(1)}s)`)
    console.log(``)
    if (compressionRatios.length > 0) {
      const medianRatio = percentile(compressionRatios, 50)
      console.log(`Compression (median, vs converted.jpg):`)
      console.log(`  ratio ${medianRatio.toFixed(3)}  (−${Math.round((1 - medianRatio) * 100)}%)`)
      console.log(``)
    }
  }

  // Detailed failures
  const allFailures = [...byOutcome.FAILED, ...byOutcome.ERROR, ...byOutcome.TIMEOUT]
  if (allFailures.length > 0) {
    console.log(`Failures:`)
    for (const r of allFailures) {
      const reason = r.processingError ?? r.errorMessage ?? r.finalStatus ?? 'unknown'
      console.log(`  ${r.outcome.padEnd(8)} ${r.filename}: ${reason}`)
    }
    console.log(``)
  }

  process.exit(completed.length === COUNT ? 0 : 1)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
