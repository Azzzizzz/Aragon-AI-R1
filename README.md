# [Project Name]

[One paragraph — what it does, the core user flow, and the key technical decision you made.]

---

## Live Demo

- App: [Vercel URL]
- API: [Railway URL]

---

## Tech Stack

Frontend: Vite + React + TypeScript + TanStack Query + Tailwind + shadcn/ui
Backend: Node + Express + TypeScript + Prisma
DB: [PostgreSQL / MongoDB]
Storage: Supabase Storage
Deploy: Vercel + Railway

---

## Running Locally

```bash
git clone [repo-url]
cp .env.example .env        # fill in values

# Backend
cd server && npm install
npm run db:migrate          # run Prisma migrations
npm run dev

# Frontend (new terminal)
cd client && npm install
npm run dev
```

---

## Environment Variables

| Variable            | Description                              |
|---------------------|------------------------------------------|
| DATABASE_URL        | Postgres connection string               |
| SUPABASE_URL        | Supabase project URL                     |
| SUPABASE_SERVICE_KEY| Supabase service role key (backend only) |
| STORAGE_BUCKET      | Supabase Storage bucket name             |
| PORT                | Server port (default: 3000)              |
| CLIENT_URL          | Frontend URL for CORS                    |
| VITE_API_URL        | Backend URL (used by frontend)           |

---

## Architecture Notes

- [Decision 1 + reason]
- [Decision 2 + reason]
- [Decision 3 + reason]

---

## Trade-offs

- [What you skipped + why]
- [What is not production-grade + why that is acceptable at this scope]

---

## What I'd Build Next

1. [Highest priority addition + why]
2. [Second]
3. [Third]
