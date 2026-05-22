# Aragon AI — Image Upload, Validation & Processing Pipeline

A full-stack web app where users drag-and-drop portrait photos and the system:

1. **Validates** each image in real-time — magic-byte format checks, blur detection, face detection, perceptual-hash duplicate detection (**Round 1**)
2. **Processes** every accepted image through an async queue-backed pipeline — format normalisation, compression, and multi-resolution variant generation (**Round 2**)

Mirrors Aragon.ai's onboarding flow for AI headshot generation. The model needs clean, varied, single-face training photos, so we filter and process at upload time.

---

## Live Demo

| | URL |
|---|---|
| App (Vercel) | https://aragon-ai-r1.vercel.app |
| API (Render) | https://aragon-ai-r1.onrender.com |

---

## Tech Stack

### Round 1 — Upload & Validation

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Vite + React 19 + TypeScript | Fast HMR, strict types |
| Styling | Tailwind CSS v4 + custom Atlas design system | Utility-first, dark theme |
| Server state | TanStack Query v5 | Per-file mutations, background refetch, cache invalidation |
| Backend | Node + Express + TypeScript | Spec requirement, familiar ecosystem |
| ORM | Prisma v6 | Type-safe queries, schema-driven migrations |
| Database | PostgreSQL via Supabase | Relational, hosted, free tier, PgBouncer pooling |
| File storage | Supabase Storage | S3-compatible, public-read CDN URLs, service-role-only writes |
| Image processing | sharp + heic-convert | Native libvips bindings, fast resize/greyscale/raw |
| Face detection | @vladmandic/face-api (TinyFaceDetector) + @tensorflow/tfjs-node | Self-contained, 0.18 MB model, ~5× faster than SSD MobileNet |
| Perceptual hashing | Custom aHash (average hash) | 64-bit hash, Hamming-distance duplicate detection |
| File upload | Pre-signed URL (Supabase Storage) | Client uploads directly to storage; server never buffers bytes |
| Deploy | Vercel (FE) + Render (BE) | Git-connected, env vars UI |

### Round 2 — Async Processing Pipeline (additions)

| Layer | Choice | Why |
|---|---|---|
| Queue | **BullMQ v5** | Purpose-built task queue for Node.js — retry, backoff, deduplication, and per-job status out of the box. No manual retry logic needed. |
| Queue backend | **Upstash Redis** (TLS `rediss://`) | Managed Redis — zero ops, pay-per-request, free tier, works directly with ioredis. No broker to provision. |
| Redis client | **ioredis** | Required by BullMQ. Handles the blocking `BRPOPLPUSH` pop pattern for worker pull semantics. |
| Image resize | **sharp** (already installed) | Generates 4 resized variants in parallel via `Promise.all` + libvips. |
| Dev process manager | **concurrently** | Starts server + 3 workers in one `npm run dev` command with colour-coded output per process. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                 │
│                                                                 │
│  React + Vite + TypeScript                                      │
│  ┌───────────────────┐   ┌─────────────────────────────────┐   │
│  │   Left Panel      │   │       Right Panel               │   │
│  │                   │   │                                 │   │
│  │  UploadDropzone   │   │  Progress bar (X of N)          │   │
│  │  react-dropzone   │   │                                 │   │
│  │  - accept filter  │   │  SessionGrid (in-place)         │   │
│  │  - 15MB guard     │   │  blob URL preview + progress    │   │
│  │                   │   │  ring while validating          │   │
│  │  FileListItem ×N  │   │                                 │   │
│  │  stage indicator  │   │  AcceptedGrid                   │   │
│  │                   │   │  useQuery(['images','ACCEPTED']) │   │
│  │                   │   │                                 │   │
│  │                   │   │  RejectedGrid                   │   │
│  │                   │   │  sessionRejected + query cache  │   │
│  └──┬─────────────┬──┘   └─────────────────────────────────┘   │
└─────┼─────────────┼───────────────────────────────────────────┘
      │ Step 1+3    │ Step 2 (direct PUT, bypasses server)
      ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXPRESS SERVER  :3000  (Render)                    │
│                                                                 │
│  POST /api/images/upload-url                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Zod validate { filename, mimeType }                  │   │
│  │ 2. Lazy cleanup of PENDING_UPLOAD rows older than 30min │   │
│  │ 3. createSignedUploadUrl(storagePath, 300s)             │   │
│  │ 4. prisma.image.create({ status: PENDING_UPLOAD })      │   │
│  │ 5. return { uploadUrl, storagePath, id }                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  POST /api/images/:id/validate  → 202 immediately              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. findUnique({ status: PENDING_UPLOAD }) → 404 if gone │   │
│  │ 2. Fire-and-forget runValidationPipeline(record)        │   │
│  │ 3. return 202 { id, status: PENDING_UPLOAD }            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  runValidationPipeline() — runs in background                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. downloadFromStorage(storagePath) → buffer            │   │
│  │ 2. file-type magic bytes → delete record if invalid     │   │
│  │ 3. heic-convert → JPEG (if HEIC), re-upload, swap paths │   │
│  │ 4. sharp.metadata() → width, height, fileSize           │   │
│  │ 5. pLimit(4) — blur + duplicate in parallel:            │   │
│  │      ├─ Laplacian variance  (blur, threshold 200)       │   │
│  │      └─ aHash 64-bit        (duplicate check vs DB)     │   │
│  │    → early exit if rejected, else face detection:       │   │
│  │      └─ TinyFaceDetector    (count + box ratio)         │   │
│  │ 6. DUPLICATE → delete record + storage, return          │   │
│  │ 7. Aggregate reasons[] → ACCEPTED | REJECTED            │   │
│  │ 8. prisma.image.update({ status, reasons, dims, ... })  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  GET /api/images/:id  → polled by client every 2s              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ returns image record; 404 = duplicate was auto-deleted  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  GET  /api/images?status=&limit=&cursor=                        │
│  DELETE /api/images/:id                                         │
└──────────────────────┬──────────────────────┬───────────────────┘
                       │                      │
                       ▼                      ▼
          ┌────────────────────┐   ┌──────────────────────────┐
          │  Supabase Postgres │   │   Supabase Storage       │
          │  + PgBouncer pool  │   │   bucket: AG-v1          │
          │  Image table       │   │   public-read CDN        │
          │  indexes: status,  │   │   path: <uuid>.jpg|png   │
          │  createdAt, pHash  │   └────────────┬─────────────┘
          └────────────────────┘                │ public URL
                                                ▼
                                       ┌─────────────────┐
                                       │  <img> preview  │
                                       │  in browser     │
                                       └─────────────────┘
```

---

## Round 2 — Async Processing Pipeline

## Round 2 — Asynchronous Media Processing Pipeline

In Round 2, we extended our robust validation architecture by introducing a highly scalable, queue-backed media processing pipeline. Once an image successfully passes validation, it is processed through three sequential stages: format conversion, quality compression, and multi-resolution variant generation.

To ensure an exceptionally fast user experience, the POST `/validate` endpoint now returns a `202 Accepted` status in under 50ms, immediately freeing up the client. The validation itself runs asynchronously in the background of the Express server, and upon completion, the accepted images are enqueued to our specialized processing workers.

```
ROUND 2 — ASYNC, DECOUPLED PIPELINE WITH BACKGROUND WORKERS
══════════════════════════════════════════════════════════════════════

  Browser  Browser  Browser  Browser  Browser
    │        │        │        │        │
    │     POST /validate  →  returns 202 in ~50ms (HTTP non-blocking)
    ▼        ▼        ▼        ▼        ▼
 ╔═══════════════════════════════════════════════════════════╗
 ║               EXPRESS SERVER (single process)             ║
 ║  • runValidationPipeline() [async in-process background]  ║
 ║  • if ACCEPTED ──► convertQueue.add(imageId, storagePath) ║
 ║  [ Non-blocking HTTP transition; background validation ]  ║
 ╚═══════════════════════════════════════════════════════════╝
                       │
                       │  job: { imageId, storagePath }
                       ▼
 ╔═══════════════════════════════════════════════════════════╗
 ║               UPSTASH REDIS  (BullMQ backend)             ║
 ║                                                           ║
 ║   aragon:convert  ████████████████████  (jobs waiting)    ║
 ║   aragon:compress ████████████          (jobs waiting)    ║
 ║   aragon:variants ████████              (jobs waiting)    ║
 ║                                                           ║
 ║   • Jobs persist across worker/server restarts            ║
 ║   • Atomic BRPOPLPUSH — only one worker claims each job   ║
 ║   • 3 attempts + exponential backoff (2s → 4s → 8s)       ║
 ╚═══════════════════════════════════════════════════════════╝
          │                    │                    │
          │  pull              │  pull              │  pull
          ▼                    ▼                    ▼
  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
  │ CONVERT       │   │ COMPRESS      │   │ VARIANTS      │
  │ worker        │   │ worker        │   │ worker        │
  │               │   │               │   │               │
  │ concur: 1     │   │ concur: 2     │   │ concur: 2     │
  │ (CPU-heavy    │   │ (lower CPU,   │   │ (I/O-bound    │
  │  re-encode)   │   │  pipeline     │   │  after decode)│
  │               │   │  overlap)     │   │               │
  │ Scale by      │   │ Scale by      │   │ Scale by      │
  │ adding procs  │   │ adding procs  │   │ adding procs  │
  └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
          │ enqueue           │ enqueue           │
          │ compress          │ variants          │ set COMPLETE
          ▼                   ▼                   ▼
 ╔═══════════════════════════════════════════════════════════╗
 ║                    Supabase Storage                       ║
 ║                                                           ║
 ║  uploads/                                                 ║
 ║    <uuid>.jpg              ← original validated image     ║
 ║                                                           ║
 ║  processed/<imageId>/                                     ║
 ║    converted.jpg           ← convert worker output        ║
 ║    compressed.jpg          ← compress worker output       ║
 ║    thumb.jpg   (300 px)    ┐                              ║
 ║    mobile.jpg  (480 px)    │                              ║
 ║    tablet.jpg  (768 px)    ├── variants worker output     ║
 ║    web.jpg    (1200 px)    │                              ║
 ║    [FULL → compressed.jpg] ┘  (reference, no re-upload)  ║
 ╚═══════════════════════════════════════════════════════════╝

  FEATURES & EXTENSIONS:
    ✓  Non-blocking HTTP flow (Server returns 202 in ~50ms, allowing immediate client UI transition)
    ✓  Queue-backed processing pipeline (convert, compress, and variants managed by BullMQ and Upstash Redis)
    ✓  Robust worker durability (worker crashes or Redis blips are automatically retried with exponential backoff)
    ✓  Independently scalable workers (each processing worker stage runs in its own process and scales independently)
    ✓  5 high-quality image variants generated in parallel (thumbnail, mobile, tablet, web, and full)
    ✓  Detailed processing metadata (compression ratio, file sizes, and status tracked in PostgreSQL)
    ✓  Idempotent reprocessing (one-click Retry triggers clean file deletion and re-enqueues jobs safely)
```

---

### Pipeline Status Progression

The client polls `GET /api/images/:id/status` every 2 seconds. Status is written to the DB **at the start** of each stage (not just at completion), so the UI shows exactly which stage is running in real time.

```
  Image accepted by validation
            │
            ▼
       ┌─────────┐
       │  QUEUED │  ← processingStatus set on Image row
       └────┬────┘     job added to aragon:convert queue
            │
            │  convert worker pulls job
            ▼
       ┌──────────────┐
       │  CONVERTING  │  ← written to DB immediately on pickup
       └──────┬───────┘
              │  sharp().toColorspace('srgb').jpeg({ quality: 92 })
              │  strips EXIF (GPS, device model)
              │  uploads processed/<id>/converted.jpg
              │  enqueues to compress queue
              ▼
       ┌─────────────┐
       │ COMPRESSING │  ← compress worker picks up
       └──────┬──────┘
              │  sharp().jpeg({ quality: 85 })
              │  records compressionRatio + compressedSize
              │  uploads processed/<id>/compressed.jpg
              │  enqueues to variants queue
              ▼
       ┌────────────────────┐
       │ GENERATING_VARIANTS│  ← variants worker picks up
       └──────────┬─────────┘
                  │  Promise.all([ resize(300), resize(480),
                  │               resize(768), resize(1200) ])
                  │  FULL → reference to compressed.jpg
                  │  upserts 5 ImageVariant rows
                  │
             ┌────┴────┐
             ▼         ▼
         COMPLETE    FAILED  ← any worker can write FAILED
                        │      with processingError message
                        │
                        ▼
               POST /api/images/:id/reprocess
               1. delete pipeline storage files
               2. delete ImageVariant rows
               3. reset processingStatus → QUEUED
               4. re-enqueue to convert
```

---

### Why Three Workers, Not One

The spec required independently scalable services. Three workers with three queues means:

| Worker | Concurrency | Resource profile | Scale trigger |
|--------|-------------|------------------|--------------|
| convert | 1 per process | CPU-heavy (re-encode) | Add more convert processes on Render |
| compress | 2 per process | Moderate CPU | Add compress instances if it lags |
| variants | 2 per process | I/O-bound after first decode | Add variant instances for high volume |

A monolith worker can't do this. If variants become the bottleneck, you can't scale just that stage without scaling everything else with it.

**Sequential between stages, parallel within:**
Stages are sequential because each depends on the output file of the previous one (compressed.jpg → variants). But inside the variants worker, all 4 resizes happen in `Promise.all` — no reason to wait on thumb.jpg before starting mobile.jpg.

---

### Why BullMQ + Redis, Not Kafka or RabbitMQ

```
  Feature                  BullMQ + Redis    RabbitMQ       Kafka
  ───────────────────────  ───────────────   ────────────   ──────────────
  Job retry built-in       ✓ native          Manual         Manual
  Exponential backoff      ✓ native          Via plugins    Via consumer
  Job deduplication        ✓ jobId param     Manual         Manual
  Per-job status           ✓ native          Limited        Not native
  Delayed jobs             ✓ native          Via plugins    Not native
  Ops overhead             Near-zero         Moderate       High
  Throughput               ~10k jobs/sec     ~50k msg/sec   ~1M msg/sec
  Persistence              Memory + AOF log  Disk-first     Disk-first
  Best for                 Task queues ✓     Routing/fanout Event streams
  Our workload             ✓ exact fit       Overkill       Overkill
```

**Kafka** is designed for event streaming at millions of messages per second. It's the right choice for telemetry aggregation, event sourcing, and multi-datacenter replay. For "process this image and advance to the next stage", it's operational complexity with no benefit — you'd need consumer groups, offset management, partition tuning, and manual retry logic.

**RabbitMQ** is closer (task queue model), but requires an AMQP broker to run and manage, retry ergonomics are worse, and job-level visibility requires the management plugin.

**BullMQ** is purpose-built for exactly this pattern: stateful jobs, typed payloads, configurable retry with backoff, deduplication via `jobId`, and a clean TypeScript API. Upstash adds zero-ops managed Redis on top.

**When to migrate to Kafka:** sustained queue backlog of 100k+ jobs, need for multi-datacenter replication guarantees, or replay of historical events. None of those apply here.

---

### Redis Tradeoffs — The Honest Version

Redis is memory-first. If the instance crashes without AOF persistence fsyncing on every write, in-flight jobs could be lost. Upstash free tier uses optimistic-volatile eviction, which means under memory pressure it can evict keys.

**Why it's acceptable here:**
- Jobs are short-lived. The queue rarely holds more than a few dozen jobs at once.
- The moment a worker picks up a job, it writes the new `processingStatus` to Postgres. If the job disappears from Redis, the image sits at its last status (`CONVERTING`, etc.) — visible to the user, recoverable via `/reprocess`.
- This is not silent data loss — it's a stalled pipeline with a clear error path.

**The real durability guarantee** comes from Postgres, not Redis. Redis is the coordination layer; Postgres is the source of truth.

---

### Distributed Coordination — How Workers Share a Queue

```
  WORKER PULL MODEL (not push)
  ════════════════════════════

  Worker process starts
        │
        │  Opens blocking Redis connection
        │  Calls BRPOPLPUSH (via BullMQ)
        │  "Give me the next job — block here if queue is empty"
        │
  Job available in Redis
        │
        ▼
  Redis atomically moves job from "waiting" list → "active" set
  (only ONE worker wins this atomic pop — Redis is the coordinator)
        │
        ▼
  Worker processes the job
        │
     ┌──┴──┐
     ▼     ▼
  resolve  throw
     │     │
     ▼     ▼
  completed  failed → retry (up to 3 attempts)


  THREE CONVERT WORKERS COMPETING FOR THE SAME QUEUE:
  ════════════════════════════════════════════════════

  Worker-A ──[BRPOPLPUSH]──▶ Redis ──▶ job-1 (Worker-A gets it)
  Worker-B ──[BRPOPLPUSH]──▶ Redis ──▶ job-2 (Worker-B gets it)
  Worker-C ──[BRPOPLPUSH]──▶ Redis ──▶ (waiting — no more jobs)

  Redis distributes load naturally.
  No master/coordinator process required.
  Adding a 4th worker instance = instant extra throughput.
```

**Distributed lock:** Once a job is in the active set, no other worker can see it. BullMQ's stalled-job detector reclaims jobs whose worker crashed mid-processing — they re-enter the waiting list after a timeout. This is the **at-least-once** guarantee: rare crashes may cause a job to run twice, which is why idempotency is non-negotiable.

---

### Idempotency — Why It's Non-Negotiable

At-least-once delivery means a job **will occasionally run twice** (worker crash + stalled job reclaim). Every stage must produce the same result whether it runs once or three times.

| Stage | How idempotency is achieved |
|-------|-----------------------------|
| Convert upload | `upsert: true` on Supabase upload — second run overwrites same path |
| Compress upload | `upsert: true` on Supabase upload |
| Variant uploads | `upsert: true` on all 4 variant files |
| ImageVariant rows | Prisma `upsert` keyed on `@@unique([imageId, type])` — no duplicates |
| Enqueue on validate | `jobId: imageId` — BullMQ rejects a duplicate job with the same ID |
| Reprocess | Removes old jobId from BullMQ history before re-enqueuing |

---

### Statelessness and Horizontal Scaling

Each worker holds **zero in-process state between jobs**. No cached image buffers, no job counters, no shared memory. Every piece of state that must survive a job lives in either:
- **Postgres** — `processingStatus`, `ImageVariant` rows, `compressionRatio`
- **Supabase Storage** — the image files

The worker process itself is ephemeral. Kill it mid-job, the stalled detector re-queues the work. Start 10 more workers, they immediately start pulling and processing — zero configuration change.

This is what "independently scalable" actually means: each worker type (convert / compress / variants) can be scaled to a different replica count on Render based on its own throughput profile.

---

### Round 2 API Endpoints

#### `GET /api/images/:id/status`

Returns the current pipeline state. Polled by the client every 2 seconds after validation.

```json
{
  "status": "ACCEPTED",
  "processingStatus": "COMPLETE",
  "processingError": null,
  "compressionRatio": 0.62,
  "compressedSize": 1138432,
  "variants": [
    { "type": "THUMBNAIL", "storageUrl": "https://...", "width": 300, "height": 400, "fileSize": 28672 },
    { "type": "MOBILE",    "storageUrl": "https://...", "width": 480, "height": 640, "fileSize": 52224 },
    { "type": "TABLET",    "storageUrl": "https://...", "width": 768, "height": 1024, "fileSize": 92160 },
    { "type": "WEB",       "storageUrl": "https://...", "width": 1200, "height": 1600, "fileSize": 159744 },
    { "type": "FULL",      "storageUrl": "https://...", "width": 3024, "height": 4032, "fileSize": 1138432 }
  ]
}
```

#### `POST /api/images/:id/reprocess`

Retries a `FAILED` job. Safe to call multiple times (idempotent).

- Only works if `processingStatus === 'FAILED'`
- Execution order: delete storage files → delete DB rows → reset to QUEUED → re-enqueue
- Response: `{ enqueued: true }` or `400 { message: "Image is not in FAILED state" }`

---

## End-to-End Request Flow

```
User drops file(s)
      │
      ▼
react-dropzone  ──── wrong MIME or >15MB? ──► toast error, abort
      │ ok
      │
      ▼  (one 3-step sequence per file, all files run in parallel)
processFile(file)
      │
      ├─ FileListItem: "Preparing…"
      │
      ▼  STEP 1 ── POST /api/images/upload-url { filename, mimeType }
      │           server: lazy orphan cleanup → createSignedUploadUrl → PENDING row
      │           returns { uploadUrl, id }
      │
      ├─ FileListItem: "Uploading…"
      │
      ▼  STEP 2 ── PUT <bytes> directly to Supabase (server not involved)
      │           browser → Supabase Storage
      │           on failure: DELETE /api/images/:id to clean up PENDING row
      │
      ├─ SessionGrid slot: circular progress ring "Validating…"
      │  (image visible immediately via local blob URL)
      │
      ▼  STEP 3 ── POST /api/images/:id/validate  → 202 immediately
      │            server fires runValidationPipeline() in background
      │
      ├─ client polls GET /api/images/:id every 2s
      │
      │  ┌─ server background pipeline ──────────────────────────┐
      │  │ downloadFromStorage → buffer                          │
      │  │ validateFormat (magic bytes)                          │
      │  │   invalid → delete record + storage → 404 on next poll│
      │  │ heic-convert → JPEG if needed                        │
      │  │ validateDimensions → TOO_SMALL?                       │
      │  │ pLimit(4):                                            │
      │  │   validateBlur + validateDuplicate  (parallel)        │
      │  │   → early exit if either rejects                      │
      │  │   → else validateFace (TinyFaceDetector)              │
      │  │ DUPLICATE → delete record + storage → 404 on next poll│
      │  │ prisma.image.update({ status, reasons, dims, pHash }) │
      │  └───────────────────────────────────────────────────────┘
      │
      ▼  poll response:
    404 → duplicate or invalid format
      ├── toast "Already uploaded", slot removed after 3s
      │
    status !== PENDING_UPLOAD → result ready
      ▼
ACCEPTED → slot stays in SessionGrid, spinner removed, ImageCard rendered
REJECTED → slot removed from SessionGrid, image injected into RejectedGrid
           (derived from sessionRejected in UploadPage — no refetch needed)
```

---

## Validation Rules

All 6 rules from the spec are implemented as **pure functions** in `server/src/validators/`, composed by `runValidations()`. Multiple reasons can apply to a single image — the DB stores an array.

| # | Reason code | Threshold | Library | Algorithm |
|---|---|---|---|---|
| 1 | `TOO_SMALL` | width < 800px **or** height < 800px **or** fileSize < 50 KB | sharp | `sharp(buffer).metadata()` → check w/h; `buffer.length` for size |
| 2 | `INVALID_FORMAT` | MIME not `image/jpeg`, `image/png`, or `image/heic` | file-type | Reads first 12 magic bytes from buffer — extension alone is not trusted |
| 3 | `DUPLICATE` | Hamming distance ≤ 10 bits vs any of last 1 000 hashes | custom aHash | Resize to 8×8 greyscale → 64-bit average hash (16 hex chars) → XOR each nibble → count set bits |
| 4 | `BLURRY` | Laplacian variance < 200 | sharp | Resize to 256×256 greyscale → apply Laplacian kernel `[0,1,0 / 1,-4,1 / 0,1,0]` over every pixel → compute variance of responses |
| 5 | `FACE_TOO_SMALL` | largest face box area / image area < 0.05 (5%) | @vladmandic/face-api | TinyFaceDetector (0.18 MB), inputSize 416, score threshold 0.5 — image resized to 640×640 before inference |
| 6 | `MULTIPLE_FACES` / `NO_FACE` | detections.length > 1 or === 0 | @vladmandic/face-api | Same detection pass as rule 5. Face check is skipped entirely if blur or duplicate already rejected the image |

> **HEIC handling:** HEIC files pass the format check, then `heic-convert` converts the buffer to JPEG (quality 0.9) before any downstream processing. The stored file and all metadata reflect the converted JPEG.

---

## API Reference

Base URL: `http://localhost:3000` (dev) · `https://aragon-ai-r1.onrender.com` (prod)

All responses are JSON. No envelopes — data returned directly. Errors: `{ "error": "..." }`.

---

### `POST /api/images/upload-url`

Issue a pre-signed upload URL and create a `PENDING_UPLOAD` record.

**Request:** `application/json`

| Field | Type | Required | Notes |
|---|---|---|---|
| `filename` | string | yes | Original filename |
| `mimeType` | string | yes | `image/jpeg` \| `image/png` \| `image/heic` \| `image/heif` |

**Response `201`**
```json
{
  "uploadUrl": "https://<project>.supabase.co/storage/v1/object/upload/sign/...",
  "storagePath": "08af282f-1234-....png",
  "id": "cmp57n2n40000pf2nlp4001cs"
}
```

**Error responses**

| Status | When |
|---|---|
| `400` | Zod validation failure (missing/invalid field) |
| `500` | Supabase signed-URL generation failed |

---

### `PUT <uploadUrl>` — Direct to Supabase

Client PUTs raw bytes directly to the signed URL. Server not involved.
URL expires in **300 seconds**. Re-request `upload-url` if expired.

---

### `POST /api/images/:id/validate`

Kick off background validation. Returns **immediately** — validation runs asynchronously. Client polls `GET /api/images/:id` for the result.

**Response `202`**

```json
{ "id": "cmp53azb4000cpfrhqcf525mb", "status": "PENDING_UPLOAD" }
```

**Error responses**

| Status | When |
|---|---|
| `404` | Record not found or already processed |
| `500` | DB failure |

---

### `GET /api/images/:id`

Fetch a single image — used by the client polling loop every 2 seconds until `status` leaves `PENDING_UPLOAD`.

**Response `200`**

```json
{
  "id": "cmp53azb4000cpfrhqcf525mb",
  "filename": "selfie.jpg",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/AG-v1/<uuid>.jpg",
  "status": "ACCEPTED",
  "rejectionReasons": [],
  "width": 2400,
  "height": 3200,
  "fileSize": 892113,
  "mimeType": "image/jpeg",
  "createdAt": "2026-05-14T06:10:50.560Z"
}
```

> **`404` means duplicate or invalid format** — the server auto-deleted the record. The client treats this as "Already uploaded" and removes the slot.

| Status | When |
|---|---|
| `404` | Record auto-deleted (duplicate or invalid format) |
| `500` | DB failure |

---

### `GET /api/images`

List images ordered newest-first. Cursor pagination scales to millions of rows.

**Query params**

| Param | Type | Default | Notes |
|---|---|---|---|
| `status` | `ACCEPTED` \| `REJECTED` | — | Omit to return all |
| `limit` | number | `50` | Max 100 |
| `cursor` | string (cuid) | — | `id` of last item from previous page |

**Response `200`**

```json
{
  "items": [
    {
      "id": "cmp53azb4000c...",
      "filename": "selfie.jpg",
      "status": "REJECTED",
      "rejectionReasons": ["BLURRY", "FACE_TOO_SMALL"],
      "publicUrl": "https://...",
      "width": 1024,
      "height": 768,
      "fileSize": 304211,
      "mimeType": "image/jpeg",
      "createdAt": "2026-05-14T06:10:50.560Z"
    }
  ],
  "nextCursor": "cmp53azb4000d..." 
}
```

> `nextCursor` is `null` on the last page.

**Why cursor over offset:** `OFFSET N` scans N rows every call — breaks at scale. Cursor uses the indexed `id` field for O(log n) lookup regardless of page depth.

---

### `DELETE /api/images/:id`

Delete image record from DB and file from Supabase Storage (both removed atomically via `Promise.all`).

**Response:** `204 No Content`

| Status | When |
|---|---|
| `404` | Image ID not found |
| `500` | Storage or DB failure |

---

## Data Model

```prisma
enum ImageStatus {
  PENDING_UPLOAD                   // URL issued, client has not called validate yet
  ACCEPTED
  REJECTED
}

enum RejectionReason {
  TOO_SMALL
  INVALID_FORMAT
  DUPLICATE
  BLURRY
  FACE_TOO_SMALL
  MULTIPLE_FACES
  NO_FACE
}

// Round 2 additions
enum ProcessingStatus {
  QUEUED
  CONVERTING
  COMPRESSING
  GENERATING_VARIANTS
  COMPLETE
  FAILED
}

enum VariantType {
  THUMBNAIL   // 300px wide
  MOBILE      // 480px wide
  TABLET      // 768px wide
  WEB         // 1200px wide
  FULL        // original compressed — reference only, no re-upload
}

model Image {
  id               String            @id @default(cuid())
  filename         String
  storagePath      String            @unique        // UUID-based, no original filename
  publicUrl        String                           // Supabase CDN URL, served directly to <img>
  status           ImageStatus       @default(PENDING_UPLOAD)
  rejectionReasons RejectionReason[]               // array — multiple reasons allowed
  fileSize         Int?                             // nullable until validate runs
  width            Int?
  height           Int?
  mimeType         String?                          // always jpeg/png after conversion
  pHash            String?                          // 16-char hex aHash for duplicate check
  // Round 2 fields
  processingStatus ProcessingStatus?               // null on REJECTED images
  processingError  String?                         // set by worker on FAILED
  compressionRatio Float?                          // e.g. 0.62 = 38% smaller
  compressedSize   Int?                            // bytes after compression
  variants         ImageVariant[]                  // 5 rows once COMPLETE
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@index([status])
  @@index([createdAt(sort: Desc)])
  @@index([pHash])
  @@index([processingStatus])                      // Round 2: admin queries by stage
}

model ImageVariant {
  id          String      @id @default(cuid())
  imageId     String
  image       Image       @relation(fields: [imageId], references: [id], onDelete: Cascade)
  type        VariantType
  storageUrl  String
  storagePath String
  width       Int
  height      Int
  fileSize    Int
  createdAt   DateTime    @default(now())

  @@unique([imageId, type])   // idempotency guarantee — upsert never creates duplicates
  @@index([imageId])
}
```

> `rejectionReasons` is a Postgres array column — no join table, no extra query, list renders in one `findMany`.
>
> `@@unique([imageId, type])` on `ImageVariant` is the idempotency key: retrying a failed variants job runs `upsert` against this constraint — existing rows are updated in-place, no duplicates created.

---

## Folder Structure

```
.
├── client/                           Frontend (Vite + React)
│   └── src/
│       ├── pages/
│       │   └── UploadPage.tsx        Full layout — two-panel, queries, progress bar
│       ├── components/
│       │   ├── UploadDropzone.tsx    Drag-and-drop, per-file upload + polling loop
│       │   ├── SessionGrid.tsx       In-place grid — processing → accepted in same slot
│       │   ├── FileListItem.tsx      Left-panel upload row — stage label + icon
│       │   ├── ImageCard.tsx         Thumbnail + pipeline badge + retry button  [R2]
│       │   ├── AcceptedGrid.tsx      Historical accepted images (presentational)
│       │   └── RejectedGrid.tsx      sessionRejected + historical rejected, with reasons
│       ├── lib/
│       │   ├── api.ts                requestUploadUrl, uploadDirect, validateUpload, del
│       │   │                         + getImageStatus, reprocessImage  [R2]
│       │   ├── rejectionMessages.ts  enum → { label, tooltip }
│       │   └── utils.ts              shadcn cn()
│       ├── types.ts                  Image, ImageStatus, RejectionReason,
│       │                             ProcessingStatus, ImageVariant  [R2]
│       ├── main.tsx                  QueryClientProvider + Sonner Toaster
│       └── App.tsx                   → UploadPage
│
├── server/
│   ├── prisma/
│   │   └── schema.prisma             Image + enums + ImageVariant model  [R2]
│   ├── scripts/
│   │   ├── fetch-test-faces.ts       Downloads N unique face images for load test
│   │   └── load-test.ts              [R2] concurrent upload + pipeline polling
│   └── src/
│       ├── workers/                  [R2] — each is a standalone Node.js entry point
│       │   ├── convert.ts            JPEG normalise, strip EXIF, sRGB → enqueue compress
│       │   ├── compress.ts           quality 85, track ratio → enqueue variants
│       │   └── variants.ts           thumb/mobile/tablet/web/full → COMPLETE
│       ├── lib/
│       │   ├── redis.ts              [R2] ioredis connection singleton (Upstash TLS)
│       │   ├── queue.ts              [R2] BullMQ Queue instances (convert/compress/variants)
│       │   ├── supabase.ts           service-role client, upload/download/delete helpers
│       │   └── faceModel.ts          TinyFaceDetector — loadFromDisk once at boot
│       ├── routes/
│       │   └── images.ts             All endpoints + enqueue trigger [R2] + /status [R2]
│       ├── validators/
│       │   ├── format.ts             file-type magic-byte check
│       │   ├── dimensions.ts         sharp metadata → width/height/size
│       │   ├── blur.ts               Laplacian variance on 256×256 greyscale
│       │   ├── duplicate.ts          aHash + Hamming distance vs DB
│       │   ├── face.ts               face-api count + box-ratio
│       │   └── index.ts              runValidations() → Promise.all of heavy checks
│       ├── index.ts                  Express app, CORS, route mount, model preload
│       ├── db.ts                     Prisma client singleton
│       ├── schemas.ts                Zod: listImagesQuerySchema, uploadUrlBodySchema
│       └── config.ts                 env var loading
│
└── package.json                      root dev script — starts all 5 processes
```

> Files marked `[R2]` are Round 2 additions.

---

## Security

| Threat | Mitigation |
|---|---|
| Malicious file disguised by extension (e.g. `.exe` → `.jpg`) | `file-type` reads magic bytes from buffer — extension never trusted |
| Path traversal via filename | Original filename never used in storage path; path is `<uuid>.<ext>` |
| Memory exhaustion via huge upload | Client enforced 15 MB limit in dropzone; server never buffers — bytes go direct to Supabase |
| Service-role key exposure | Lives only in server `.env`, never sent to client. Bucket is public-read but writes require the key |
| CORS abuse | `cors()` middleware with `origin: CLIENT_URL` — single trusted origin only |
| SQL injection | Prisma parameterised queries; zero raw SQL |
| XSS via filename in UI | Filenames rendered as React text nodes only, never `innerHTML` |
| SSRF | No user-supplied URLs are ever fetched |
| Stored executables served as images | Magic-byte check filters at ingest; Supabase sets `Content-Type` from upload metadata |

---

## Architecture Decisions

### 1 — Pre-signed URL over proxy upload

Client uploads directly to Supabase Storage; the server never holds the raw bytes. This eliminates multer buffer stacking on the 512 MB Render instance — the root cause of recurring OOM crashes.

**Pros:** Server RAM free during upload; uploads as fast as client → Supabase CDN edge; any number of concurrent uploads with zero server memory cost.

**Cons:** Two-step client flow; orphan files possible if client crashes between upload and validate. Mitigated with `PENDING_UPLOAD` status + lazy 30-min TTL cleanup on every upload-url request. Server still downloads bytes once to validate, but under `pLimit(1)` — no stacking.

The alternative (proxy upload) was the original design. It keeps validation atomic in one request, but the server must buffer the entire file in RAM alongside Sharp decode + TF.js inference — which reliably hits the 512 MB ceiling on larger images.

### 2 — Async fire-and-forget validation with client polling

`POST /:id/validate` returns `202` immediately; `runValidationPipeline` runs in the background. The client polls `GET /api/images/:id` every 2 seconds until `status` leaves `PENDING_UPLOAD`. All files start their pipeline in parallel — the user sees per-image progress rings resolve independently as each one finishes.

Inside the pipeline, blur + duplicate detection run in `Promise.all` (both are cheap CPU ops). Face detection is skipped entirely if either of those already rejected the image — eliminating the 1.5s TensorFlow inference on obviously bad photos.

### 3 — Validators as pure functions

`(buffer, metadata) => reason | null`. Stateless, composable, easy to unit-test, share across endpoints. The composition layer (`validators/index.ts`) handles parallelism.

### 4 — TinyFaceDetector over SSD MobileNet

Switched from SSD MobileNet v1 (5.4 MB) to TinyFaceDetector (0.18 MB) — 30× smaller, ~5× faster inference. Images are resized to 640×640 before decoding into a TF tensor, reducing memory spike per validation from ~200 MB to ~40 MB, which matters on a 512 MB Render instance.

The model loads once at boot via `faceapi.nets.tinyFaceDetector.loadFromDisk(...)` before `app.listen()`. Every subsequent request reuses the in-memory weights.

### 5 — One Image table, denormalized

`rejectionReasons` is a Postgres enum array column on the `Image` row — no join table, no second query. List rendering stays one `findMany`.

### 6 — aHash over pHash library

Implemented inline with `sharp` (already a dependency) rather than adding `imghash`. Average hash on an 8×8 greyscale thumbnail: O(64) comparison, zero extra native binaries.

---

## Trade-offs & Explicit Cuts

| Cut | Why |
|---|---|
| Authentication / users | Not in spec; would cost 30+ min with no demo value |
| WebSockets / SSE | Polling every 2s gives equivalent real-time feedback at this scale |
| pgvector similarity search | aHash + Hamming distance is sufficient for MVP duplicate detection |
| Bull Board admin UI | Would give queue-depth dashboard; skipped for time — Upstash console covers it |
| mozjpeg encoder | Would reduce file size further; disabled for speed — toggle `mozjpeg: true` in sharp options |
| Retry / resumable uploads | Files ≤ 15 MB on stable connection; retry adds complexity |
| Rate limiting | Single-user demo scope |
| Crop button on rejected cards | UI flourish from spec screenshots; outside core validation flow |
| FULL variant as separate upload | FULL = reference to compressed.jpg — saves one upload + one redundant file |

---

## Production Roadmap

| Priority | Feature | Why |
|---|---|---|
| 1 | **Validation Offloading Queue** | Completely decouple image validation (magic-byte check, HEIC convert, blur/duplicate detection, face detection) from the Express process by introducing a 4th queue (`aragon:validate`) and a background validation worker. This fully eliminates Express server OOM risks. |
| 2 | **Server-Sent Events (SSE)** | Push validation results and pipeline status to client instead of polling; better UX and lower database request rates at scale |
| 3 | **Auth (Supabase Auth)** | Row-level security so users only see their own images |
| 4 | **pgvector embeddings** | Replace aHash with CLIP embeddings for semantically-aware duplicate detection |
| 5 | **Supabase image transforms** | On-the-fly thumbnails + WebP for grid performance |
| 6 | **Rate limiting** | `express-rate-limit` per IP to prevent abuse |
| 7 | **Typed error responses** | Replace `{ error: string }` with structured error codes for client-side error states |

---

## Deployment

### Service Topology on Render

Round 2 runs as **4 separate Render services** (1 web + 3 background workers) all sharing the same Supabase Postgres, Supabase Storage, and Upstash Redis. The frontend is deployed separately on Vercel.

```
  Vercel (Frontend)
  ┌─────────────────────────────────┐
  │  client/  (Vite + React)        │
  │  VITE_API_URL → Render API URL  │
  └─────────────────────────────────┘
                  │ HTTP
                  ▼
  Render (Web Service)
  ┌─────────────────────────────────────────────────────┐
  │  aragon-api                                         │
  │  Root dir: server/                                  │
  │  Build:    npm install && npm run build             │
  │  Start:    node --expose-gc dist/index.js           │
  │  Handles:  /api/images/* — upload, validate,        │
  │            status, reprocess, delete                │
  └──────────────────────┬──────────────────────────────┘
                         │ enqueue jobs
                         ▼
  ┌──────────────────────────────────────┐
  │         UPSTASH REDIS                │
  │  aragon:convert / compress / variants│
  └──────┬──────────────┬────────────────┘
         │              │              │
         ▼              ▼              ▼
  Render (Background Worker × 3)
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │aragon-convert│ │aragon-compress│ │aragon-variants│
  │              │ │              │ │              │
  │Root: server/ │ │Root: server/ │ │Root: server/ │
  │Build: npm i  │ │Build: npm i  │ │Build: npm i  │
  │       + build│ │       + build│ │       + build│
  │Start: node   │ │Start: node   │ │Start: node   │
  │  dist/workers│ │  dist/workers│ │  dist/workers│
  │  /convert.js │ │  /compress.js│ │  /variants.js│
  └──────────────┘ └──────────────┘ └──────────────┘
         │              │              │
         └──────────────┴──────────────┘
                        │ reads/writes
                        ▼
  ┌────────────────────────────────────────┐
  │       Supabase (Postgres + Storage)    │
  │  DB: Image rows, ImageVariant rows     │
  │  Storage: uploads/ + processed/<id>/   │
  └────────────────────────────────────────┘
```

---

### Render Service Configuration

#### 1. API — Web Service (`aragon-api`)

| Field | Value |
|-------|-------|
| **Type** | Web Service |
| **Root directory** | `server` |
| **Build command** | `npm install && npm run build` |
| **Start command** | `node --expose-gc dist/index.js` |
| **Instance type** | Starter (512 MB) or Standard (2 GB for production) |
| **Auto-deploy** | On push to `main` |

#### 2. Convert Worker — Background Worker (`aragon-convert`)

| Field | Value |
|-------|-------|
| **Type** | Background Worker |
| **Root directory** | `server` |
| **Build command** | `npm install && npm run build` |
| **Start command** | `node dist/workers/convert.js` |
| **Instance type** | Starter (concurrency=1 means it's CPU-light at idle) |
| **Scaling** | Add replicas as convert throughput demands grow |

#### 3. Compress Worker — Background Worker (`aragon-compress`)

| Field | Value |
|-------|-------|
| **Type** | Background Worker |
| **Root directory** | `server` |
| **Build command** | `npm install && npm run build` |
| **Start command** | `node dist/workers/compress.js` |
| **Instance type** | Starter |
| **Scaling** | Add replicas independently of convert and variants |

#### 4. Variants Worker — Background Worker (`aragon-variants`)

| Field | Value |
|-------|-------|
| **Type** | Background Worker |
| **Root directory** | `server` |
| **Build command** | `npm install && npm run build` |
| **Start command** | `node dist/workers/variants.js` |
| **Instance type** | Starter |
| **Scaling** | Add replicas independently |

---

### Environment Variables Per Service

All four Render services need the same core set. Add each as a Render environment variable (not in `.env` files — those are local-only).

| Variable | API | Convert | Compress | Variants |
|----------|-----|---------|----------|---------|
| `DATABASE_URL` | ✓ | ✓ | ✓ | ✓ |
| `DIRECT_URL` | ✓ | — | — | — |
| `SUPABASE_URL` | ✓ | ✓ | ✓ | ✓ |
| `SUPABASE_SERVICE_KEY` | ✓ | ✓ | ✓ | ✓ |
| `STORAGE_BUCKET` | ✓ | ✓ | ✓ | ✓ |
| `UPSTASH_REDIS_URL` | ✓ | ✓ | ✓ | ✓ |
| `NODE_ENV` | `production` | `production` | `production` | `production` |
| `CLIENT_URL` | ✓ (Vercel URL) | — | — | — |
| `PORT` | `3000` | — | — | — |

> **Tip:** Use a Render [Environment Group](https://render.com/docs/environment-variables#environment-groups) to share the common variables across all 4 services at once. Any change to the group propagates to all services automatically.

---

### Deployment Flow (What Happens on `git push main`)

```
  git push main
       │
       ▼
  GitHub triggers Render auto-deploy on all 4 services simultaneously

  ┌─────────────────────────────────────────────────────┐
  │ Each service independently:                         │
  │                                                     │
  │  1. Pull latest code                                │
  │  2. Run build: npm install && npm run build         │
  │     (TypeScript → dist/ via tsc)                    │
  │  3. New instance starts (new process)               │
  │  4. Old instance receives SIGTERM                   │
  │     Workers: finish current job, then exit          │
  │     API: drain in-flight HTTP requests, then exit   │
  │  5. Traffic/jobs routed to new instance             │
  └─────────────────────────────────────────────────────┘

  Zero-downtime for the API (Render handles graceful swap).

  Workers: a job in progress when SIGTERM fires will
  complete (shutdown handler calls worker.close() which
  waits for active job to finish before exiting).
  No jobs are lost on redeploy.
```

The `SIGTERM` shutdown handler in every worker:
```typescript
const shutdown = async () => {
  await worker.close()   // waits for active job to finish
  await connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

---

### Horizontal Scaling — How to Scale Each Worker

All workers are **stateless and pull-based**. Scaling is purely a replica count decision — no code changes, no configuration changes, no coordination needed.

```
  CURRENT (1 replica each):
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ convert  │   │ compress │   │ variants │
  │ ×1       │   │ ×1       │   │ ×1       │
  └──────────┘   └──────────┘   └──────────┘

  AFTER SCALING (if convert is the bottleneck):
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ convert  │   │ compress │   │ variants │
  │ ×3       │   │ ×1       │   │ ×1       │
  └──────────┘   └──────────┘   └──────────┘

  All 3 convert replicas pull from the same aragon:convert
  Redis queue. Redis distributes jobs atomically — no
  duplicate processing, no coordination needed.
```

| Bottleneck signal | Action |
|-------------------|--------|
| `aragon:convert` queue depth growing, convert workers at 100% CPU | Add convert replicas on Render |
| Images stuck at COMPRESSING for a long time | Add compress replicas |
| Images stuck at GENERATING_VARIANTS | Add variants replicas |
| API response time rising | Scale the Web Service (vertical or horizontal) |

---

### Schema Migrations on Deploy

Workers and the API share the same Prisma client. When the schema changes:

```bash
# Run ONCE before deploying code — from local with DIRECT_URL set:
cd server && npx prisma db push

# Then deploy code to all 4 services as normal.
# Workers pick up the new client types automatically after rebuild.
```

> **Never run `prisma db push` from a worker process at startup** — it would race with other workers on cold start and can lock the DB.

---

## Local Development

**Prerequisites:** Node 20+, Supabase project with a Storage bucket, Upstash Redis account (free tier).

```bash
# 1. Clone and install
git clone <repo-url>
cd aragon-ai

npm install                  # root (concurrently)
npm install --prefix server
npm install --prefix client

# 2. Environment
cp server/.env.example server/.env
# Fill in ALL variables — see Environment Variables section below

# 3. Push schema to Supabase (run once, or after schema changes)
cd server && npx prisma db push && npx prisma generate

# 4. Start everything — server + all 3 workers (from repo root)
npm run dev
# → client     on http://localhost:5173   (cyan)
# → server     on http://localhost:3000   (yellow)
# → convert    worker                     (green)
# → compress   worker                     (blue)
# → variants   worker                     (magenta)

# Optional: start workers separately (for scaling experiments)
npm run dev:workers --prefix server   # all 3 workers only (no server)
npm run dev:convert --prefix server   # single worker
```

```bash
# Load test (Round 2)
# First time: fetch unique test face images
npm run fetch-faces --prefix server -- --count=50

# Run the load test
npm run loadtest --prefix server -- --count=50 --concurrency=20

# Optional flags
npm run loadtest --prefix server -- \
  --count=50          \ # total images to submit
  --concurrency=20    \ # max in-flight simultaneously
  --poll=1000         \ # status poll interval (ms)
  --timeout=300000    \ # per-image timeout (ms)
  --base-url=http://localhost:3000
```

> **Face model:** bundled inside `node_modules/@vladmandic/face-api/model` — no manual download needed.

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `DATABASE_URL` | server | Supabase pooled connection (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | server | Supabase direct connection (port 5432) — used by `prisma db push` only |
| `SUPABASE_URL` | server | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | server | Service-role key — never exposed to client |
| `STORAGE_BUCKET` | server | Supabase Storage bucket name (e.g. `AG-v1`) |
| `UPSTASH_REDIS_URL` | server | **Round 2** — `rediss://default:<password>@<host>.upstash.io:6379` — from Upstash console → Database → Redis URL (use the `rediss://` TLS URL, not the REST URL) |
| `PORT` | server | Default `3000` |
| `NODE_ENV` | server | `development` \| `production` |
| `CLIENT_URL` | server | Frontend origin for CORS (default `http://localhost:5173`) |
| `VITE_API_URL` | client | Backend URL consumed by `api.ts` (default `http://localhost:3000`) |

> **Upstash setup (5 minutes):** console.upstash.com → Create Database → Regional → copy the `rediss://` URL → paste as `UPSTASH_REDIS_URL` in `server/.env`.

---

## Test Cases

### Happy path
| # | Input | Expected |
|---|---|---|
| 1 | Valid JPG, single face, ≥ 800×800 | `ACCEPTED` — appears in top grid |
| 2 | Valid PNG | `ACCEPTED` |
| 3 | Valid HEIC | Converted to JPEG server-side, `ACCEPTED` |
| 4 | 6 files dropped simultaneously | All upload in parallel, per-file spinners, all resolve independently |

### Each rejection rule
| # | Input | Expected reason |
|---|---|---|
| 5 | 400×300 image | `TOO_SMALL` |
| 6 | PDF renamed to `.jpg` | `INVALID_FORMAT` (magic-byte check catches it server-side even if FE filter bypassed) |
| 7 | `.bmp` file in picker | Rejected by dropzone, never reaches server |
| 8 | Same image uploaded twice | First → `ACCEPTED`, second → `DUPLICATE` |
| 9 | Visibly blurry portrait | `BLURRY` |
| 10 | Wide shot, face in distance | `FACE_TOO_SMALL` |
| 11 | Group photo | `MULTIPLE_FACES` |
| 12 | Landscape with no people | `NO_FACE` |
| 13 | Blurry group photo | `["BLURRY", "MULTIPLE_FACES"]` (multiple reasons in array) |

### Edge cases
| # | Scenario | Expected |
|---|---|---|
| 14 | File > 15 MB | react-dropzone rejects before any request, toast "exceeds 15 MB limit" |
| 15 | 0-byte file | 400, toast |
| 16 | Corrupt JPEG (truncated) | sharp throws, 400, toast |
| 17 | Network failure mid-upload | Step fails with error toast; client calls DELETE /:id to clean up PENDING row |
| 18 | Delete accepted image | Removed from grid, file deleted from Supabase Storage |
| 19 | Refresh page | In-flight uploads lost (expected — no resumable); completed images persist via GET |

---

## AI Assistance

Used AI to accelerate:
- Boilerplate Express route handlers and Prisma schema skeleton
- Laplacian variance algorithm reference implementation
- face-api.js + TensorFlow Node.js setup (no browser canvas)
- Component scaffolding and Tailwind class combinations

Decided independently:
- Pre-signed URL upload (debated trade-offs, chose presigned to eliminate OOM on 512 MB instance)
- Validator architecture (pure functions, `Promise.all` composition)
- Single `Image` table with enum array over join table
- Sync-per-file + parallel-client-requests as the "async" answer
- Index strategy: `status`, `createdAt desc`, `pHash`
- aHash implemented with existing `sharp` dep over adding `imghash`
- Full explicit cuts list and production roadmap
