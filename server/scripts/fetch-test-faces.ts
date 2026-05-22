/**
 * One-shot bootstrap: fetch N unique synthetic faces from thispersondoesnotexist.com
 * and save them to client/public/test-images/load-test/ for use by the load test.
 *
 * Rerun-safe: existing files are skipped, so partial runs can resume by re-invoking.
 *
 *   npx tsx server/scripts/fetch-test-faces.ts --count=50
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../client/public/test-images/load-test')
const SOURCE_URL = 'https://thispersondoesnotexist.com/'
const DELAY_MS = 400 // be polite — avoid hammering the free service
const MIN_BYTES = 50_000 // anything smaller is almost certainly an error page

function getArg(name: string, def: string): string {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return m ? m.split('=')[1] : def
}

const COUNT = parseInt(getArg('count', '50'), 10)
const MAX_RETRIES = parseInt(getArg('retries', '3'), 10)

async function fetchOne(): Promise<Buffer> {
  const res = await fetch(SOURCE_URL, {
    headers: {
      // Some image hosts gate on a user agent
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < MIN_BYTES) throw new Error(`response too small (${buf.length}B) — likely an error page`)
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (no SOI magic)')
  return buf
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  let fetched = 0
  let skipped = 0
  let failed = 0

  console.log(`Fetching up to ${COUNT} faces from ${SOURCE_URL}`)
  console.log(`Output: ${OUT_DIR}\n`)

  for (let i = 1; i <= COUNT; i++) {
    const filename = `face-${String(i).padStart(3, '0')}.jpg`
    const path = resolve(OUT_DIR, filename)

    if (existsSync(path)) {
      console.log(`[${i.toString().padStart(3)}/${COUNT}] ${filename} already exists, skipping`)
      skipped++
      continue
    }

    let saved = false
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const buf = await fetchOne()
        writeFileSync(path, buf)
        console.log(`[${i.toString().padStart(3)}/${COUNT}] saved ${filename} (${(buf.length / 1024).toFixed(1)}KB)`)
        fetched++
        saved = true
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (attempt < MAX_RETRIES) {
          console.warn(`[${i.toString().padStart(3)}/${COUNT}] attempt ${attempt} failed (${message}), retrying…`)
          await new Promise((r) => setTimeout(r, 1000 * attempt))
        } else {
          console.error(`[${i.toString().padStart(3)}/${COUNT}] giving up after ${MAX_RETRIES} attempts: ${message}`)
          failed++
        }
      }
    }

    if (saved && i < COUNT) await new Promise((r) => setTimeout(r, DELAY_MS))
  }

  console.log(`\nDone — fetched: ${fetched}, skipped (already present): ${skipped}, failed: ${failed}`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
