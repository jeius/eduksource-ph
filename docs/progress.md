# EdukSource PH — Progress

Current execution status and immediate next steps. Updated per the weekly check-in (see `docs/plan.md` §1). Roadmap lives in `docs/plan.md`.

**Status as of:** 2026-08-24

## Current phase

Phase 1 — Foundation (`docs/plan.md` §2). Track B (Studio) in progress; Track A complete through Phase 2 API-first stubs (catalog).

## Done

- Phase 0 — planning document set complete (PRD, architecture, tech-stack, plan)
- Phase 1 Track A:
  - Monorepo scaffold (Turborepo + pnpm, Biome, shared tsconfig)
  - Supabase + Drizzle: `packages/db` schema + single migration history applied to Supabase (ADR-0004)
  - API foundation on Cloudflare Workers: Hono app with env validation (`DATABASE_URI`, `INTERNAL_SERVICE_TOKEN` ≥32 chars), health route, shared errors/logger/auth middleware
  - Catalog module (Phase 2): `GET /products` (filters + limit pagination), `GET /products/:id`, `POST /internal/products` (service-token auth, 401/409/422) — OpenAPI generated from Zod via `@hono/zod-openapi`
  - bow-documents module: `GET/POST /internal/bow-documents` durable cache keyed by 64-hex content hash (ADR-0007), R2 key-only storage
  - `GET /openapi.json`; verified `GET /health` 200 without DB and `/internal/*` 401 without token (tests run against real Supabase via `app.request()` — no `wrangler dev` needed)
  - `.dev.vars.example` with `INTERNAL_SERVICE_TOKEN` placeholder
- Phase 1 Track B:
  - Hono.js project skeleton (Node runtime)
  - AI provider API key + test call
  - PDF extraction route: BOW PDF → structured objectives JSON (vision fallback, caching, token budgeting)
  - In-memory extraction result cache (per-file hash)
  - Provider registry with cross-provider fallback (ADR-0002)

## In progress

- Phase 1 Track B: lesson plan generation route

## Next up

- Track A: Cloudflare setup (Workers deploy, R2 buckets, Turnstile); BetterAuth sessions replacing the stub auth middleware
- Track B: PPTX generation → DOCX generation → summative/term test → manual end-to-end test
- Phase 2 remainder: cart/orders/checkout modules (Track A); studio refinement (Track B)
