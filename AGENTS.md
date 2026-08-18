# AGENTS.md

Instructions for any coding agent (Claude Code, opencode, or otherwise) working in this repo. This file is intentionally tool-agnostic — no assumptions about which agent is reading it.

> Scope lives in `docs/PRD.md`, architecture in `docs/architecture.md`, roadmap in `docs/plan.md`, execution status in `docs/progress.md`. Read them before starting work. Individual architectural decisions and their reasoning live in `/docs/adr/`.

---

## Project summary

EdukSource PH — a marketplace selling DepEd BOW-aligned teaching materials, plus an internal AI pipeline (`studio`) that generates draft materials from a BOW PDF for an editor to review. Turborepo monorepo, pnpm workspaces.

Four apps: `store` (public storefront), `admin` (internal dashboard), `api` (backend, Cloudflare Workers), `studio` (AI generation pipeline, Node, admin/editor-only). A fifth, `docs`, comes later (see `docs/plan.md` Phase 7).

---

## Setup & commands

```bash
pnpm install                          # install all workspace dependencies

pnpm dev                              # run all apps in dev mode (Turborepo)
pnpm dev --filter=@eduksource/store   # run a single app
pnpm dev --filter=@eduksource/studio

pnpm dev:worktree:init                # run after worktree creatiion
pnpm dev:worktree:clean               # run to clean-up disk space for preserved worktrees

pnpm build                            # build all apps
pnpm build:packages                   # build all packages

pnpm check-types                      # TypeScript across the workspace
pnpm lint                             # Biome
pnpm format                           # Biome format
pnpm fix                              # Biome fix for all linting and format issues

pnpm test                             # Vitest, unit/integration
pnpm test:e2e                         # Playwright — checkout flow + Studio pipeline are the priority paths
```

> These commands reflect the intended Turborepo setup per `docs/plan.md` (Development Approach) and `docs/tech-stack.md`.

---

## Repo structure & boundaries

```txt
apps/
  store/        # Tanstack Start — public storefront
  admin/        # Tanstack Start — admin/editor dashboard
  api/          # Hono on Cloudflare Workers — sole owner of Postgres writes
  studio/       # Hono on Node — AI generation pipeline, admin/editor-only
  docs/         # (later) Tanstack Start — renders the modular docs, ADRs, OpenAPI specs
packages/
  ui/           # shared shadcn-ui components
  db/           # drizzle schema + migrations — used ONLY by api
  auth/         # betterAuth config, shared across api/store/admin
  email/        # resend templates (react-email)
  logger/       # shared logger to use instead of console.log
  schemas/      # shared zod schemas
  config/       # shared tsconfig, biome config
docs/PRD.md          # product requirements & scope
docs/architecture.md # system design & boundaries
docs/tech-stack.md   # tech stack
docs/plan.md         # roadmap & SDLC
docs/progress.md     # execution status
docs/adr/            # architecture decision records
```

**Hard boundaries — do not cross these without first checking `docs/architecture.md` / relevant ADR:**

- `packages/db` (Drizzle schema, Postgres access) is imported by `api` only. `studio` does **not** get a Postgres connection — it uploads generated files directly to R2 and calls `api`'s endpoints to persist product metadata. See ADR-0001 and `docs/architecture.md` §2.3.
- `studio` runs on Node, not Cloudflare Workers, and is deployed separately from the other apps. Don't "simplify" it onto Workers — see ADR-0001 for why that doesn't work (memory/CPU limits, native modules).
- `admin` ↔ `studio` auth is a separate internal service token, not the BetterAuth session used elsewhere. Don't assume BetterAuth session cookies are available inside `studio`.
- AI provider calls inside `studio` go through the provider registry (`apps/studio/src/lib/ai/`), not direct hardcoded client calls to a specific provider. See ADR-0002 — provider/model choice is meant to be swappable via config, not hardcoded per call site.
- Downloads are always signed, expiring R2 URLs. Never generate or hardcode a public bucket link.

## Project documentation

Modular docs — one concern per file:

- `docs/PRD.md` — product requirements & scope
- `docs/architecture.md` — system design, boundaries, security, data flow
- `docs/tech-stack.md` — tech stack
- `docs/plan.md` — development approach (SDLC), roadmap, risks
- `docs/progress.md` — current execution status, next steps
- `docs/adr/` — ADRs (individual decisions)
- `docs/libraries/`, `docs/models/` — library/model notes
- `docs/plans/` + `docs/specs/` — **finalized** plans/specs, committed, source of truth for completed work
- `docs/superpowers/plans/` + `docs/superpowers/specs/` — specs/plans exclusive to superpowers skills that agents consume (gitignored scratch, not a source of truth). A plan/spec moves to `docs/{plans,specs}` when finalized.
- `docs/audit-checklist.md` — repo-vs-docs audit procedure

Update the doc for a concern when the decision changes, not just when you remember to. OpenAPI specs are generated from Zod schemas (not hand-written); CHANGELOGs are generated from Conventional Commits.

---

## Architecture Decision Records — check before touching these areas

`/docs/adr/` holds the reasoning behind decisions that are expensive to reverse. Before working in an area listed below, open the linked ADR — don't rediscover (or accidentally undo) reasoning that's already been settled.

| ADR | Governs | Check before... |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [0001](docs/adr/0001-two-runtime-split.md) | Workers (platform) vs. Node (`studio`) runtime split | touching `studio`'s deployment, hosting, or "why isn't this on Workers" |
| [0002](docs/adr/0002-swappable-ai-provider-registry.md) | AI provider registry — NIM/OpenRouter/Opencode Go, swappable by config | adding/changing any AI call inside `studio` |
| [0003](docs/adr/0003-studio-no-direct-db-access.md) | `studio` has no Postgres access; goes through `api`'s internal endpoint | anything that looks like "just give studio a DB connection for convenience" |
| [0004](docs/adr/0004-supabase-temporary-db.md) | Supabase as the (explicitly temporary) Postgres host | changing `packages/db`'s connection setup or evaluating DB hosting |
| [0005](docs/adr/0005-paymongo-primary-payment-rail.md) | PayMongo primary / Stripe secondary payment rails | touching checkout, payment webhooks, or currency handling |

This table needs to stay in sync — add a row here whenever a new ADR is written (see below).

---

## Conventions

- **TypeScript everywhere**, strict mode. No `any` without a comment explaining why it's unavoidable.
- **Zod for all input validation** — every API route (both `api` and `studio`) validates input with a shared schema from `packages/schemas` where the shape is reused across apps, or a local schema otherwise.
- **Biome** for lint/format — run `pnpm lint` and `pnpm format` before committing; don't hand-format against Biome's config.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, etc.) — commit messages feed changelog generation later, so keep them accurate.
- **Trunk-based development**: `main` stays deployable. Short-lived branches, one PR per task, squash-merge. See `docs/plan.md` §1 for the full rationale (this is a solo project — the PR is a review checkpoint, not a team ceremony).
- **Definition of Done = the "Exit criteria" line** at the bottom of each roadmap phase in `docs/plan.md` (Roadmap section). If you're not sure whether a phase is finished, check there before moving on.

---

## When making a non-trivial decision

If you (the agent) are about to make a call that would be annoying to reverse later — a new dependency, a schema change, a new service boundary, a provider/vendor choice — write a short ADR in `/docs/adr/` using the template at `/docs/adr/0000-template.md` rather than just doing it silently. Keep it to Context / Decision / Alternatives Considered / Consequences, a page or less. **Add a row to the index table above** when you do — an ADR nobody knows to look for is close to not existing. This project already has five real decisions documented this way (0001–0005); keep the pattern going rather than letting reasoning live only in commit messages or chat history.

---

## Things to flag, not silently work around

- Anything touching AI provider licensing terms ("production use" definitions per NIM/OpenRouter/Opencode Go) — flag before assuming it's fine, especially once Studio output is actually being sold. See ADR-0002.
- Anything that would expose `studio` or admin-only `api` routes publicly (e.g. while building the `docs` app's API reference) — Studio is explicitly admin/editor-only for now; public self-serve access is a deferred future feature (`docs/PRD.md` §3), not something to build toward by default.
- Secrets, API keys, or credentials — never hardcode or commit them, even temporarily "to test." Use the existing env var pattern.

---

## Migrating from CLAUDE.md

This file replaces `CLAUDE.md`. If `CLAUDE.md` still exists in the repo, it's stale — delete it rather than maintaining both.
