# CLAUDE.md

## CRITICAL: Never commit or push without explicitly asking the user first.

---

## Project
Aragon AI — Image upload, validation, and async processing pipeline (Round 1 + Round 2)

---

## Tech Stack
- Frontend: Vite + React + TypeScript + TanStack Query + Tailwind CSS + shadcn/ui
- Backend: Node + Express + TypeScript + Prisma (v6)
- DB: PostgreSQL (Supabase) + Connection Pooling (PgBouncer)
- Storage: Supabase Storage (presigned upload URL flow)
- Queue: BullMQ v5 + Upstash Redis (`UPSTASH_REDIS_URL` — `rediss://` TLS URL)
- Image processing: sharp (resize, compress, normalize) + heic-convert (HEIC→JPEG)
- Deploy: Vercel (frontend) + Render (backend + 3 background workers)

---

## Build & Development Commands

**Root:**
- `npm run dev`: Start client + server + all 3 workers (5 processes via concurrently)
- `npm run db:studio`: Open Prisma Studio

**Server:**
- `npx prisma@6 db push`: Sync schema to Supabase (uses DIRECT_URL)
- `npm run build`: Compile TypeScript
- `npm start`: Run compiled server
- `npm run dev:convert`: Start convert worker standalone
- `npm run dev:compress`: Start compress worker standalone
- `npm run dev:variants`: Start variants worker standalone

**Client:**
- `npm run dev`: Start Vite dev server
- `npm run build`: Build for production

**Scripts:**
- `npx tsx scripts/load-test.ts --count=50 --concurrency=20`: Run load test

---

## Architecture Rules

1. Route handler → DB call directly. No service layer, no repository pattern.
2. Validate at route boundary with Zod. Nowhere else.
3. Return data directly. No response envelopes like { success, data, error }.
4. Upload flow: server generates presigned URL → client uploads directly to Supabase → client sends path back to server to save.
5. TanStack Query for all server state. No Redux. No Zustand unless cross-screen client-only state exists.
6. Two layers max. No abstraction until the same code appears 3+ times.
7. No console.log in final code.
8. Atomic commits — one commit per task. Format: `type(scope): description`.

### Round 2 Pipeline Rules (additional)

9. Storage prefixes: `uploads/<uuid>.ext` for originals, `processed/<imageId>/` for all pipeline output.
10. Queue names must be namespaced: `aragon:convert`, `aragon:compress`, `aragon:variants`.
11. Every queue must have: `attempts: 3, backoff: { type: "exponential", delay: 2000 }`.
12. Workers set `processingStatus` at the START of their stage, not just at the end.
13. On worker error: update DB to FAILED + processingError, THEN throw (so BullMQ retries).
14. Use `upsert` (never `create`) for ImageVariant rows — idempotency is non-negotiable.
15. FULL variant references `compressed.jpg` directly — do not re-upload.
16. Reprocess order: delete storage files → delete DB rows → reset status → re-enqueue.

---

## Planning Docs (in .notes/ — gitignored)

### Round 1 docs
- `.notes/execution-plan.md`  — Round 1 step-by-step plan (complete)
- `.notes/spec.md`            — Round 1 original brief
- `.notes/architecture.md`    — Round 1 folder structure and key decisions
- `.notes/api.md`             — Round 1 endpoint contracts

### Round 2 docs — READ THESE before writing any Round 2 code
- `.notes/round2/plan.md`           — CANONICAL: tasks, parallel waves, commit messages
- `.notes/round2/todo.md`           — task checklist (update as you go)
- `.notes/round2/SPEC.md`           — structured spec
- `.notes/round2/flow-comparison.md`— architecture diagrams + tradeoffs
- `.notes/round2/spec-round2.md`    — original Round 2 brief from Aragon

---

## Round 2 MVP Scope

MUST HAVE:
- [x] BullMQ + Upstash Redis queue infrastructure
- [x] Convert worker (normalize JPEG, strip EXIF)
- [x] Compress worker (quality 85, track ratio)
- [x] Variants worker (thumb 300 / mobile 480 / tablet 768 / web 1200 / full ref)
- [x] GET /api/images/:id/status endpoint
- [x] POST /api/images/:id/reprocess endpoint
- [x] Frontend: processing status badge + variant display + reprocess button
- [x] Load test script (50 concurrent images)

EXPLICIT CUTS:
- [ ] Bull Board UI — reason: status endpoint sufficient for demo, adds scope
- [ ] SSE/WebSocket push — reason: polling every 3s is fine for this challenge
- [ ] Automated test suite — reason: no time budget, manual QA documented instead
- [ ] Per-worker retry backoff tuning — reason: BullMQ defaults (attempts:3, exp 2s) are fine

---

## Folder Structure

    client/src/
      pages/           ← screen-level components
      components/ui/   ← shadcn components (copy-pasted)
      lib/
        api.ts         ← all fetch wrappers (incl. getImageStatus, reprocessImage)
        utils.ts       ← shadcn cn() utility
      hooks/           ← custom hooks only if used 2+ places
      main.tsx
      App.tsx

    server/src/
      routes/          ← one file per resource
      workers/         ← Round 2: convert.ts, compress.ts, variants.ts
      lib/
        supabase.ts    ← supabase client singleton
        redis.ts       ← ioredis connection (Upstash)
        queue.ts       ← BullMQ Queue instances (aragon:convert/compress/variants)
        faceModel.ts   ← face-api init
      index.ts         ← Express app
      db.ts            ← Prisma client singleton
      schemas.ts       ← Zod schemas

    server/prisma/
      schema.prisma    ← data model (incl. ProcessingStatus, VariantType, ImageVariant)

    scripts/
      load-test.ts     ← Round 2 load test script

---

## AI Usage During This Session

Write code within decisions already made in .notes/ docs.
Do not suggest patterns outside the architecture rules above.
Prefer simple over clever.
Ask before adding any abstraction not already planned.
