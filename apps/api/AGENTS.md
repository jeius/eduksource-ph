# apps/api — Marketplace Backend (Cloudflare Workers, sole Postgres owner)

Single Cloudflare Worker. Owns all Postgres writes, organized into modules along bounded-context lines. See `apps/api/CONTEXT.md` for vocabulary (Module, Port, Domain event, Internal route) and `docs/specs/2026-08-19-api-modular-monolith-design.md` for the full structure.

## Modular monolith structure

- `src/modules/<context>/` — one per bounded context: Catalog, Cart, Orders, Checkout, Licenses, Coupons, Reviews, Feedback, BOW Documents.
- Each module: `routes.ts`, `service.ts`, `port.ts`, `index.ts` (barrel), optional `events.ts` / `internal-routes.ts`.
- Mirror in `packages/db/src/schema/` — one file per module's tables; `index.ts` is the combined drizzle-kit source.
- Full structure: `docs/specs/2026-08-19-api-modular-monolith-design.md` §2.

## Module boundary rules

1. A module's Drizzle tables are touched ONLY by that module's own `service.ts`.
2. Cross-module calls go through `port.ts` (RPC-shaped: single input object, single return value), never `service.ts` directly.
3. `index.ts` is the only import path other modules may use (re-exports `routes.ts` + `port.ts`, never `service.ts`).
4. Cross-module SQL joins allowed when performance calls (deliberate exception).
5. Domain events announce without knowing listeners (bus = Phase 10 seam, `shared/events/bus.ts`).
6. Two route kinds, two auth regimes: `routes.ts` (session) / `internal-routes.ts` (service token); never mix.

Auth is not a module — cross-cutting middleware every module uses.

## DB ownership (ADR-0003, ADR-0004)

- api is sole Postgres gatekeeper. studio/search go through `/internal/*` (service token). See ADR-0003.
- Supabase = temporary host (ADR-0004); avoid Supabase-specific features (Auth, Storage, RLS-as-primary). Drizzle keeps the migration path clean.

## Local ADR index

_No package-specific ADRs yet._ 0007/0008 live in `apps/studio/docs/adr/` (studio is producer; api is consumer). 0004 stays root `docs/adr/` until `packages/db` lands, then moves to `packages/db/docs/adr/` — see ADR-0010.

## Pointer to root + CONTEXT

- Domain vocabulary → `apps/api/CONTEXT.md`
- Cross-cutting (commands, conventions, commit style, ADR process) → root `AGENTS.md`
- Full structure → `docs/specs/2026-08-19-api-modular-monolith-design.md`
