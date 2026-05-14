# CLAUDE.md

## CRITICAL: Never commit or push without explicitly asking the user first.

---

## Project
[Name] — [one-line description — fill after reading spec]

---

## Tech Stack
- Frontend: Vite + React + TypeScript + TanStack Query + Tailwind CSS + shadcn/ui
- Backend: Node + Express + TypeScript + Prisma (v6)
- DB: PostgreSQL (Supabase) + Connection Pooling (PgBouncer)
- Storage: Supabase Storage (presigned upload URL flow)
- Deploy: Vercel (frontend) + Render (backend)

---

## Build & Development Commands

**Root:**
- `npm run dev`: Start both client and server
- `npm run db:studio`: Open Prisma Studio

**Server:**
- `npx prisma@6 db push`: Sync schema to Supabase (uses DIRECT_URL)
- `npm run build`: Compile TypeScript
- `npm start`: Run compiled server

**Client:**
- `npm run dev`: Start Vite dev server
- `npm run build`: Build for production

---

## Architecture Rules

1. Route handler → DB call directly. No service layer, no repository pattern.
2. Validate at route boundary with Zod. Nowhere else.
3. Return data directly. No response envelopes like { success, data, error }.
4. Upload flow: server generates presigned URL → client uploads directly to Supabase → client sends path back to server to save.
5. TanStack Query for all server state. No Redux. No Zustand unless cross-screen client-only state exists.
6. Two layers max. No abstraction until the same code appears 3+ times.
7. No console.log in final code.
8. Commit at each stable checkpoint. One commit per feature/endpoint.

---

## Planning Docs (in .notes/ — gitignored)

READ execution-plan.md FIRST before writing any code. It has the step-by-step plan with live status.

- .notes/execution-plan.md  — step-by-step plan with status tracking
- .notes/spec.md            — original brief (pasted at 10 AM)
- .notes/planning.md        — must-have, should-have, explicit cuts, core flow
- .notes/data-model.md      — schema decisions with reasoning
- .notes/api.md             — endpoint contracts (request/response shapes)
- .notes/architecture.md    — folder structure and key decisions
- .notes/ui.md              — color palette and component list

---

## MVP Scope

[Fill this section after reading the spec — before writing any code]

MUST HAVE:
- [ ] fill

EXPLICIT CUTS:
- [ ] fill — reason: fill

---

## Folder Structure

    client/src/
      pages/           ← screen-level components
      components/ui/   ← shadcn components (copy-pasted)
      lib/
        api.ts         ← all fetch wrappers
        utils.ts       ← shadcn cn() utility
      hooks/           ← custom hooks only if used 2+ places
      main.tsx
      App.tsx

    server/src/
      routes/          ← one file per resource
      lib/
        supabase.ts    ← supabase client singleton
      index.ts         ← Express app
      db.ts            ← Prisma client singleton
      schemas.ts       ← Zod schemas

    server/prisma/
      schema.prisma    ← data model

---

## AI Usage During This Session

Write code within decisions already made in .notes/ docs.
Do not suggest patterns outside the architecture rules above.
Prefer simple over clever.
Ask before adding any abstraction not already planned.
