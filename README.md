# Aragon AI — Image Upload & Validation

A full-stack web app where users drag-and-drop portrait photos and the system categorises each one into **Accepted** or **Rejected** in near real-time, with a precise reason for every rejection. Mirrors Aragon.ai's onboarding flow for AI headshot generation — the model needs clean, varied, single-face training photos, so we filter at upload time rather than downstream.

---

## Live Demo

| | URL |
|---|---|
| App (Vercel) | _deploy pending_ |
| API (Railway) | _deploy pending_ |

---

## Tech Stack

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
| Face detection | @vladmandic/face-api + @tensorflow/tfjs-node | Self-contained, no external API key |
| Perceptual hashing | Custom aHash (average hash) | 64-bit hash, Hamming-distance duplicate detection |
| File upload | Pre-signed URL (Supabase Storage) | Client uploads directly to storage; server never buffers bytes |
| Deploy | Vercel (FE) + Railway (BE) | Git-connected, env vars UI |

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
│  │  - accept filter  │   │  AcceptedGrid                   │   │
│  │  - 15MB guard     │   │  useQuery(['images','ACCEPTED']) │   │
│  │                   │   │                                 │   │
│  │  FileListItem ×N  │   │  RejectedGrid                   │   │
│  │  3-step sequence  │   │  useQuery(['images','REJECTED']) │   │
│  │  Preparing →      │   │  hover tooltip per reason       │   │
│  │  Uploading →      │   │                                 │   │
│  │  Validating → Done│   │                                 │   │
│  └──┬─────────────┬──┘   └─────────────────────────────────┘   │
└─────┼─────────────┼───────────────────────────────────────────┘
      │ Step 1+3    │ Step 2 (direct PUT, bypasses server)
      ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXPRESS SERVER  :3000  (Railway)                   │
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
│  POST /api/images/:id/validate                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. findUnique({ status: PENDING_UPLOAD }) → 404 if gone │   │
│  │ 2. downloadFromStorage(storagePath) → buffer            │   │
│  │ 3. file-type magic bytes → bail 400 if not jpg/png/heic │   │
│  │ 4. heic-convert → JPEG (if HEIC), re-upload, swap paths │   │
│  │ 5. sharp.metadata() → width, height, fileSize           │   │
│  │ 6. pLimit(1) → Promise.all:                             │   │
│  │      ├─ Laplacian variance  (blur check)                │   │
│  │      ├─ aHash 64-bit        (duplicate check vs DB)     │   │
│  │      └─ face-api SSD v1     (count + box ratio)         │   │
│  │ 7. Aggregate reasons[] → ACCEPTED | REJECTED            │   │
│  │ 8. prisma.image.update({ status, reasons, dims, ... })  │   │
│  │ 9. return 201 { id, status, rejectionReasons, ... }     │   │
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
      ├─ FileListItem: "Validating…"
      │
      ▼  STEP 3 ── POST /api/images/:id/validate
      │
      ▼
downloadFromStorage(storagePath)    ← server fetches bytes from Supabase
      │
      ▼
validateFormat(buffer)              ← file-type reads magic bytes
      │  not jpg/png/heic?
      ├──────────► 400, storage + DB row deleted, error toast
      │
      ▼
HEIC? → heic-convert → JPEG → re-upload as .jpg → delete HEIC original
      │
      ▼
validateDimensions(buffer)          ← sharp.metadata()
      │  w<800 or h<800 or <50KB?
      ├──────────► TOO_SMALL added to reasons[]
      │
      ▼
pLimit(1) → Promise.all([
  validateBlur(buffer),             ← Laplacian variance on 256×256 greyscale
  validateDuplicate(buffer),        ← aHash → Hamming vs last 1000 DB hashes
  validateFace(buffer)              ← face-api SSD MobileNet v1
])
      │
      ▼
Aggregate reasons[] → status = reasons.length === 0 ? ACCEPTED : REJECTED
      │
      ▼
prisma.image.update({ status, rejectionReasons, publicUrl, pHash, dims, ... })
      │  storage object kept regardless — UI renders preview for rejected too
      ▼
201 { id, status, rejectionReasons, publicUrl, width, height, ... }
      │
      ▼  back in browser
FileListItem → spinner becomes ✓ or ✗
TanStack Query invalidates ['images'] → AcceptedGrid + RejectedGrid refetch
Card appears in the correct grid
```

---

## Validation Rules

All 6 rules from the spec are implemented as **pure functions** in `server/src/validators/`, composed by `runValidations()`. Multiple reasons can apply to a single image — the DB stores an array.

| # | Reason code | Threshold | Library | Algorithm |
|---|---|---|---|---|
| 1 | `TOO_SMALL` | width < 800px **or** height < 800px **or** fileSize < 50 KB | sharp | `sharp(buffer).metadata()` → check w/h; `buffer.length` for size |
| 2 | `INVALID_FORMAT` | MIME not `image/jpeg`, `image/png`, or `image/heic` | file-type | Reads first 12 magic bytes from buffer — extension alone is not trusted |
| 3 | `DUPLICATE` | Hamming distance ≤ 10 bits vs any of last 1 000 hashes | custom aHash | Resize to 8×8 greyscale → 64-bit average hash (16 hex chars) → XOR each nibble → count set bits |
| 4 | `BLURRY` | Laplacian variance < 100 | sharp | Resize to 256×256 greyscale → apply Laplacian kernel `[0,1,0 / 1,-4,1 / 0,1,0]` over every pixel → compute variance of responses |
| 5 | `FACE_TOO_SMALL` | largest face box area / image area < 0.05 (5%) | @vladmandic/face-api | SSD MobileNet v1, min confidence 0.5, tf.node.decodeImage for buffer → native tensor |
| 6 | `MULTIPLE_FACES` / `NO_FACE` | detections.length > 1 or === 0 | @vladmandic/face-api | Same detection pass as rule 5 |

> **HEIC handling:** HEIC files pass the format check, then `heic-convert` converts the buffer to JPEG (quality 0.9) before any downstream processing. The stored file and all metadata reflect the converted JPEG.

---

## API Reference

Base URL: `http://localhost:3000` (dev) · `<Railway URL>` (prod)

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

Download from storage, validate, and update the DB record.

**Response `201`**

```json
{
  "id": "cmp53azb4000cpfrhqcf525mb",
  "filename": "selfie.jpg",
  "storagePath": "dc1a3fad-1aab-4bd5-921c-0b4835884ea9.jpg",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/AG-v1/<uuid>.jpg",
  "status": "ACCEPTED",
  "rejectionReasons": [],
  "width": 2400,
  "height": 3200,
  "fileSize": 892113,
  "mimeType": "image/jpeg",
  "pHash": "a3f07c1e4b8d2096",
  "createdAt": "2026-05-14T06:10:50.560Z",
  "updatedAt": "2026-05-14T06:10:50.560Z"
}
```

**Error responses**

| Status | When |
|---|---|
| `400` | File not found in storage / invalid format |
| `404` | Record not found or already validated |
| `500` | Storage, conversion, or DB failure |

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
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@index([status])                  // AcceptedGrid / RejectedGrid filter
  @@index([createdAt(sort: Desc)])   // default list order
  @@index([pHash])                   // duplicate check lookup
}
```

> `rejectionReasons` is a Postgres array column — no join table, no extra query, list renders in one `findMany`.

---

## Folder Structure

```
.
├── client/                         Frontend (Vite + React)
│   └── src/
│       ├── pages/
│       │   └── UploadPage.tsx      Full layout — two-panel, queries, progress bar
│       ├── components/
│       │   ├── UploadDropzone.tsx  Drag-and-drop area, per-file useMutation
│       │   ├── FileListItem.tsx    Upload row — icon, filename, spinner/check/✗
│       │   ├── ImageCard.tsx       Thumbnail + trash + hover tooltip
│       │   ├── AcceptedGrid.tsx    Accepted image grid (presentational)
│       │   └── RejectedGrid.tsx    Rejected section with "Didn't Meet Guidelines"
│       ├── lib/
│       │   ├── api.ts              requestUploadUrl, uploadDirect, validateUpload, del
│       │   ├── rejectionMessages.ts enum → { label, tooltip }
│       │   └── utils.ts            shadcn cn()
│       ├── types.ts                Image, ImageStatus, RejectionReason, ImagesResponse
│       ├── main.tsx                QueryClientProvider + Sonner Toaster
│       └── App.tsx                 → UploadPage
│
└── server/                         Backend (Express + Prisma)
    ├── prisma/
    │   └── schema.prisma           Image model + enums + 3 indexes
    └── src/
        ├── routes/
        │   └── images.ts           POST /upload-url, POST /:id/validate, GET /, DELETE /:id
        ├── validators/
        │   ├── format.ts           file-type magic-byte check
        │   ├── dimensions.ts       sharp metadata → width/height/size
        │   ├── blur.ts             Laplacian variance on 256×256 greyscale
        │   ├── duplicate.ts        aHash + Hamming distance vs DB
        │   ├── face.ts             face-api count + box-ratio
        │   └── index.ts            runValidations() → Promise.all of heavy checks
        ├── lib/
        │   ├── supabase.ts         service-role client, uploadToStorage, deleteFromStorage
        │   └── faceModel.ts        SSD MobileNet — loadFromDisk once at boot
        ├── index.ts                Express app, CORS, route mount, model preload
        ├── db.ts                   Prisma client singleton
        ├── schemas.ts              Zod: listImagesQuerySchema
        └── config.ts               env var loading
```

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

### 2 — Synchronous validation per file, parallel requests from client

Each file fires its own `POST` in parallel from the browser. The user sees per-file spinners resolve independently — identical UX to async, without a job queue. Inside one request, the three expensive checks (`blur`, `pHash`, `face`) run in `Promise.all` so wall time is `max(three)` not `sum(three)`.

### 3 — Validators as pure functions

`(buffer, metadata) => reason | null`. Stateless, composable, easy to unit-test, share across endpoints. The composition layer (`validators/index.ts`) handles parallelism.

### 4 — Face model loaded once at server boot

`faceapi.nets.ssdMobilenetv1.loadFromDisk(...)` runs before `app.listen()`. Every subsequent request reuses the in-memory model. First request after a cold start pays no extra penalty.

### 5 — One Image table, denormalized

`rejectionReasons` is a Postgres enum array column on the `Image` row — no join table, no second query. List rendering stays one `findMany`.

### 6 — aHash over pHash library

Implemented inline with `sharp` (already a dependency) rather than adding `imghash`. Average hash on an 8×8 greyscale thumbnail: O(64) comparison, zero extra native binaries.

---

## Trade-offs & Explicit Cuts

| Cut | Why |
|---|---|
| Authentication / users | Not in spec; would cost 30+ min with no demo value |
| Job queue (BullMQ + Redis) | Parallel sync requests deliver identical UX for single-user demo. Mentioned as production path in Loom |
| WebSockets / SSE | Per-file HTTP responses give equivalent real-time feedback at this scale |
| pgvector similarity search | aHash + Hamming distance is sufficient for MVP duplicate detection |
| Thumbnail resize / CDN transforms | Supabase serves originals; thumbnails are a production concern |
| Retry / resumable uploads | Files ≤ 15 MB on stable connection; retry adds complexity |
| Rate limiting | Single-user demo scope |
| PATCH /api/images/:id | `status` is server-determined — there's no field the user should edit |
| Crop button on rejected cards | UI flourish from the spec screenshots; outside the core validation flow |

---

## Production Roadmap

| Priority | Feature | Why |
|---|---|---|
| 1 | **BullMQ + Redis job queue** | Decouple upload receipt from processing; handle spikes; retry failed validations |
| 2 | **Server-Sent Events (SSE)** | Push validation results to client instead of polling; better UX at scale |
| 3 | **Auth (Supabase Auth)** | Row-level security so users only see their own images |
| 4 | **pgvector embeddings** | Replace aHash with CLIP embeddings for semantically-aware duplicate detection |
| 5 | **Supabase image transforms** | On-the-fly thumbnails + WebP for grid performance |
| 6 | **Rate limiting** | `express-rate-limit` per IP to prevent abuse |
| 7 | **Typed error responses** | Replace `{ error: string }` with structured error codes for client-side error states |

---

## Local Development

**Prerequisites:** Node 20+, a Supabase project with a Storage bucket named `AG-v1` (or update `STORAGE_BUCKET`).

```bash
# 1. Clone and install
git clone <repo-url>
cd aragon-ai

npm install                  # root (concurrently)
npm install --prefix server
npm install --prefix client

# 2. Environment
cp .env.example .env
# Fill in: DATABASE_URL, DIRECT_URL, SUPABASE_URL,
#          SUPABASE_SERVICE_KEY, STORAGE_BUCKET

# 3. Push schema to Supabase (run once, or after schema changes)
cd server && npx prisma@6 db push

# 4. Start both servers (from repo root)
npm run dev
# → client on http://localhost:5173
# → server on http://localhost:3000
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
| `PORT` | server | Default `3000` |
| `NODE_ENV` | server | `development` \| `production` |
| `CLIENT_URL` | server | Frontend origin for CORS (default `http://localhost:5173`) |
| `VITE_API_URL` | client | Backend URL consumed by `api.ts` (default `http://localhost:3000`) |

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
