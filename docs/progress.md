# EdukSource PH — Progress

Current execution status and immediate next steps. Updated per the weekly check-in (see `docs/plan.md` §1). Roadmap lives in `docs/plan.md`.

**Status as of:** 2026-08-18

## Current phase

Phase 1 — Foundation (`docs/plan.md` §2). Track B (Studio) in progress; Track A: monorepo scaffold complete, Cloudflare/Supabase setup not started.

## Done

- Phase 0 — planning document set complete (PRD, architecture, tech-stack, plan)
- Phase 1 Track A: monorepo scaffold (Turborepo + pnpm, Biome, shared tsconfig)
- Phase 1 Track B:
  - Hono.js project skeleton (Node runtime)
  - AI provider API key + test call
  - PDF extraction route: BOW PDF → structured objectives JSON (vision fallback, caching, token budgeting)
  - In-memory extraction result cache (per-file hash)
  - Provider registry with cross-provider fallback (ADR-0002)

## In progress

- Phase 1 Track B: lesson plan generation route

## Next up

- Track A: Cloudflare setup (Workers, R2, Turnstile); Supabase + Drizzle schema
- Track B: PPTX generation → DOCX generation → summative/term test → manual end-to-end test
- Phase 2: BetterAuth + API skeleton (Track A); studio refinement (Track B)
