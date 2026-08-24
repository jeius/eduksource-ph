# AGENTS.md

Instructions for any coding agent (Claude Code, opencode, or otherwise) working in this repo. This file is intentionally tool-agnostic — no assumptions about which agent is reading it.

> Scope lives in `docs/PRD.md`, architecture in `docs/architecture.md`, roadmap in `docs/plan.md`, execution status in `docs/progress.md`. Per-package rules live in `apps/<x>/AGENTS.md` or `packages/<x>/AGENTS.md`. See "Where to read first" below.

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
  <name>/            # canonical app layout (built: api, studio — others planned)
    AGENTS.md        # package-specific engineering rules + tool contracts
    CONTEXT.md       # domain glossary (if the app has domain terms)
    docs/adr/        # package-specific ADRs
    src/
packages/
  <name>/            # canonical package layout (built: config, logger — others planned)
    AGENTS.md        # package-specific contract (minimal for infra packages)
    CONTEXT.md       # only if domain terms accrue (config/logger skip)
    docs/adr/        # package-specific ADRs (lazy)
    src/
docs/                # repo-wide: PRD, architecture, tech-stack, plan, progress, adr (repo-wide),
                     #   libraries, models, plans, specs, superpowers, audit-checklist, agents
workflows/           # operational specs of recurring loops (material pipeline, BOW monitor, email triage)
NOTES.md             # raw interview record
CONTEXT-MAP.md       # points at per-context CONTEXT.md files
```

> Per-package `AGENTS.md` / `CONTEXT.md` / `docs/adr/` land the day code lands, not before (ADR-0010). Planned: `packages/{db,auth,email,schemas,ui}`, `apps/{store,admin,docs,search}`. Rules that will move when each lands: db-import lock → `packages/db/AGENTS.md`; BetterAuth config contract → `packages/auth/AGENTS.md`; shared Zod schemas contract → `packages/schemas/AGENTS.md`.

**Hard boundaries — do not cross these without first checking `docs/architecture.md` / relevant ADR:**

- `packages/db` (Drizzle schema, Postgres access) is imported by `api` only. See ADR-0001 and `docs/architecture.md` §2.3. Studio-specific no-DB, runtime, provider-registry, and service-token rules live in `apps/studio/AGENTS.md`.
- Downloads are always signed, expiring R2 URLs. Never generate or hardcode a public bucket link.

## Where to read first

| Concern | Where |
|---|---|
| What the product is & why | `docs/PRD.md` |
| System design & boundaries | `docs/architecture.md` |
| Tech stack | `docs/tech-stack.md` |
| Roadmap & phased plan | `docs/plan.md` |
| Execution status | `docs/progress.md` |
| Repo-wide locked decisions | `docs/adr/` |
| A package's engineering rules + tool contracts | `apps/<x>/AGENTS.md` or `packages/<x>/AGENTS.md` |
| A package's domain vocabulary | `apps/<x>/CONTEXT.md` (or `packages/<x>/CONTEXT.md` where it exists) |
| Package-specific locked decisions | `apps/<x>/docs/adr/` |
| How to track work | `docs/agents/issue-tracker.md` |
| Recurring-loop operational specs | `workflows/` |

---

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
- `workflows/` — operational specs of recurring loops (material pipeline, BOW monitor, email triage) — source of truth for how the loops run. See `docs/plan.md` roadmap phases that implement them
- `NOTES.md` — raw interview record of the user's world, tools, channels, and terminology (loop-me/grilling); sharpen fuzzy terms to canonical ones here

Update the doc for a concern when the decision changes, not just when you remember to. OpenAPI specs are generated from Zod schemas (not hand-written); CHANGELOGs are generated from Conventional Commits.

---

## Architecture Decision Records — check before touching these areas

`/docs/adr/` holds repo-wide decisions; per-package ADRs live in `apps/<x>/docs/adr/` or `packages/<x>/docs/adr/`. Before working in an area listed below, open the linked ADR — don't rediscover (or accidentally undo) reasoning that's already been settled.

| ADR | Governs | Location | Check before... |
| --- | --- | --- | --- |
| [0001](docs/adr/0001-two-runtime-split.md) | Workers (platform) vs. Node (studio) runtime split | `docs/adr/` | touching studio's deployment, hosting, or "why isn't this on Workers" |
| [0002](apps/studio/docs/adr/0002-swappable-ai-provider-registry.md) | AI provider registry — NIM/OpenRouter/Opencode, swappable by config | `apps/studio/docs/adr/` | adding/changing any AI call inside studio |
| [0003](apps/studio/docs/adr/0003-studio-no-direct-db-access.md) | studio has no Postgres access; goes through api's internal endpoint | `apps/studio/docs/adr/` | anything that looks like "just give studio a DB connection for convenience" |
| [0004](docs/adr/0004-supabase-temporary-db.md) | Supabase as the (explicitly temporary) Postgres host | `docs/adr/` (→ `packages/db/docs/adr/` when db lands) | changing `packages/db`'s connection setup or evaluating DB hosting |
| [0005](docs/adr/0005-paymongo-primary-payment-rail.md) | PayMongo primary / Stripe secondary payment rails | `docs/adr/` | touching checkout, payment webhooks, or currency handling |
| [0006](apps/studio/docs/adr/0006-slide-content-chained-off-lesson-plan.md) | Slide content generated from the lesson plan, not the raw BOW | `apps/studio/docs/adr/` | touching studio's slide generation flow or where slide content comes from |
| [0007](apps/studio/docs/adr/0007-bow-extractions-durable-content-hash.md) | BOW extractions are durable, api-owned records keyed by content hash | `apps/studio/docs/adr/` | changing studio's extraction identity/persistence or `bow_documents` |
| [0008](apps/studio/docs/adr/0008-bow-extraction-normalized-text-hash.md) | BOW extraction identity = normalized-text hash, with catalog safety net | `apps/studio/docs/adr/` | touching studio's extraction identity, cache reuse, or re-download reuse |
| [0009](docs/adr/0009-search-service-microservices-vehicle.md) | Search service (`apps/search`) as the microservices vehicle | `docs/adr/` | adding another microservice, message broker, or IPC work in this repo |
| [0010](docs/adr/0010-per-package-docs-locality-adr-split-tsconfig-dedup.md) | Per-package docs locality, ADR location split, tsconfig dedup | `docs/adr/` | adding a package, relocating an ADR, or changing the shared tsconfig |

This table needs to stay in sync — add a row here whenever a new ADR is written anywhere (root or per-package), with its Location. See ADR-0010.

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

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Multi-context layout: root `CONTEXT-MAP.md` points to per-context `CONTEXT.md` files. See `docs/agents/domain.md`.
