# Per-Package Docs Restructure — Execution Spec

**Status:** Accepted — implementation spec. Execution playbook for ADR-0010.
**Depends on:** [ADR-0010](../adr/0010-per-package-docs-locality-adr-split-tsconfig-dedup.md) (the locked policy), `docs/agents/issue-tracker.md` (local-markdown tracker), `docs/agents/domain.md` (per-context `CONTEXT.md` layout), `apps/api/CONTEXT.md` (api vocabulary), `docs/specs/2026-08-19-api-modular-monolith-design.md` (api module-boundary rules).
**Why now, not later:** Repo is early — only `apps/studio`, `packages/config`, `packages/logger` have code; `apps/api` has `CONTEXT.md` + a finalized spec but no `src/`. Moving text now is nearly free; waiting until packages accumulate code makes the same restructure expensive.

---

## 1. Goal

Turn the shallow root-pooled docs into deep per-package modules, relocate ADRs to their owning package, and dedup the node-runtime tsconfig flags — per ADR-0010. Three candidates execute as four commits (one for the policy docs, one per candidate), each independently revertible.

---

## 2. Commit 1 — `docs: add ADR-0010 and restructure spec`

Files created:

- `docs/adr/0010-per-package-docs-locality-adr-split-tsconfig-dedup.md`
- `docs/specs/2026-08-21-per-package-docs-restructure.md` (this file)

No code moves. Locks the policy before acting.

**Verification:** none (docs-only). Render-check the ADR against `docs/adr/0000-template.md` sections (Context / Decision / Alternatives Considered / Consequences).

---

## 3. Commit 2 — Candidate A: `refactor(docs): split per-package AGENTS.md and CONTEXT.md`

### 3.1 Files created

#### `apps/studio/AGENTS.md` (thick — see §3.2 outline)

#### `apps/studio/CONTEXT.md`

Studio domain glossary. Terms to pin (from ADR-0002/0006/0007/0008 + the generation pipeline):

- **Extraction** — the structured output of parsing a BOW PDF (objectives JSON). _Avoid_: parse result, BOW cache entry.
- **Extraction identity** — normalized-text hash (ADR-0008) with a catalog safety net; studio computes it, `api` persists it as a durable record (ADR-0007). _Avoid_: cache key, content hash (the hash is the identity's computation, not the identity concept).
- **Provider registry** — the swappable AI-provider seam at `apps/studio/src/lib/ai/` (ADR-0002). NIM primary, OpenRouter secondary, Opencode tertiary. _Avoid_: AI client, LLM wrapper.
- **Lesson plan** — the intermediate artifact slides are generated from (ADR-0006). _Avoid_: lesson, plan.
- **Task type** — the per-task model slot (extraction, ocr, lesson-plan, summative-test, image). _Avoid_: model role.
- **BOW Document** — reuse the api `CONTEXT.md` term; studio produces the extraction that becomes one.

#### `apps/api/AGENTS.md`

Interface exists (modular-monolith spec + `CONTEXT.md`), implementation empty. Restate the boundary rules so a Phase 2 agent hits the right structure from commit one. Outline — see §3.3.

#### `packages/config/AGENTS.md` (minimal)

- What `config` exports: `@eduksource/config/ts/*` (base/node/react/vite), `@eduksource/config/biome/*`, `@eduksource/config/vitest`.
- Rule: **packages extend the runtime-appropriate `@eduksource/config/ts/<runtime>.json` and import biome config from here** — don't hand-roll a tsconfig or biome config in a package.
- Rule: tsconfig strict-baseline changes land in `packages/config/src/typescript/{base,node,react,vite}.json`, not duplicated per consumer (ADR-0010 §3).
- Pointer to root for cross-cutting (commands, conventions, commit style).

#### `packages/logger/AGENTS.md` (minimal)

- What `logger` exports: the shared logger.
- Rule: **use this instead of `console.log`**; in `studio` (stdio MCP-adjacent? no — studio is HTTP/Hono, but stderr-only discipline still applies for diagnostics that must not corrupt JSON responses) diagnostics go to `console.error` (stderr) only.
- Pointer to root for cross-cutting.

> Note: `logger` gets no `CONTEXT.md` (infra, no domain terms per ADR-0010 §1). Same for `config`.

### 3.2 `apps/studio/AGENTS.md` outline (thick)

```
# apps/studio — AI Generation Pipeline (Node, admin/editor-only)
## What this module is
  Hono on Node; BOW PDF → draft teaching materials; Fly.io; separate runtime from platform.
## Runtime & deployment (ADR-0001)
  - Node, not Workers; don't "simplify" onto Workers (memory/CPU, native modules).
  - Fly.io (fly.toml), scale-to-zero; separate deploy pipeline from platform.
## Service-to-service auth
  - admin↔studio = internal service token, NOT BetterAuth session.
  - Don't assume session cookies available.
## AI provider registry (ADR-0002)
  - All AI calls go through apps/studio/src/lib/ai/ registry.
  - Never direct hardcoded provider client at a call site.
  - Provider/model swappable via config (AI_PROVIDER, AI_MODEL_* env).
  - Three providers: NIM (primary), OpenRouter (secondary), Opencode (tertiary).
## No Postgres access (ADR-0003)
  - studio never imports packages/db, never gets a DB connection.
  - Uploads generated files to R2 (S3-compatible API, own credentials).
  - Persists product metadata by calling api's /internal/* endpoints (service token).
## Route contracts
  - GET /health — liveness
  - GET /health/chat — primary provider ping
  - GET /health/chat/stream — streaming ping
  - GET /health/providers — configured providers + per-task models
  - POST /api/extract — multipart `file` (PDF) → structured BOW JSON
      side effects: R2 upload (when extraction is durable per ADR-0007/0008) + api internal call
## Extraction identity (ADR-0007/0008)
  - Identity = normalized-text hash (ADR-0008), with catalog safety net.
  - Extractions are durable, api-owned records keyed by content hash (ADR-0007).
  - studio computes the identity; api persists it.
## Slide content (ADR-0006)
  - Slide content generated from the lesson plan, NOT the raw BOW.
  - Don't feed raw BOW to slide generation.
## Env-var discipline
  - Full schema in src/config/env.ts; never hardcode keys.
  - Per-task model overrides via AI_MODEL_* (see README).
## Local ADR index
  0002, 0003, 0006, 0007, 0008 — located in apps/studio/docs/adr/
## Pointer to root
  cross-cutting rules (commands, conventions, commit style) → root AGENTS.md
```

### 3.3 `apps/api/AGENTS.md` outline

```
# apps/api — Marketplace Backend (Cloudflare Workers, sole Postgres owner)
## What this module is
  single Cloudflare Worker; owns all Postgres writes; modular monolith.
## Modular monolith structure
  - src/modules/<context>/ — one per bounded context (Catalog, Cart, Orders, Checkout,
    Licenses, Coupons, Reviews, Feedback, BOW Documents).
  - Each module: routes.ts, service.ts, port.ts, index.ts (barrel), optional events.ts /
    internal-routes.ts.
  - Full structure: docs/specs/2026-08-19-api-modular-monolith-design.md
## Module boundary rules
  1. A module's Drizzle tables touched ONLY by its own service.ts.
  2. Cross-module calls go through port.ts (RPC-shaped), never service.ts directly.
  3. index.ts is the only import path other modules may use.
  4. Cross-module SQL joins allowed when performance calls (deliberate exception).
  5. Domain events announce without knowing listeners (bus = Phase 10 seam).
  6. Two route kinds, two auth regimes: routes.ts (session) / internal-routes.ts
     (service token); never mix.
## Auth is not a module
  cross-cutting middleware, not a bounded context.
## DB ownership (ADR-0003, ADR-0004)
  - api is sole Postgres gatekeeper; studio/search go through /internal/* (service token).
  - Supabase = temporary host (ADR-0004); avoid Supabase-specific features.
## Local ADR index
  (none yet — 0007/0008 live in studio as producer; api is consumer.
   0004 stays root until packages/db lands, then moves to packages/db/docs/adr/.)
## Pointer to root + CONTEXT
  domain vocabulary → apps/api/CONTEXT.md; cross-cutting → root AGENTS.md
```

### 3.4 Root `AGENTS.md` edits

**Drop:**

- "Migrating from CLAUDE.md" section — `CLAUDE.md` no longer exists (stale).

**Trim "Hard boundaries"** from 5 bullets to 2 + 1 pointer:

- Keep bullet 1's db-import-lock half: "`packages/db` (Drizzle schema, Postgres access) is imported by `api` only. See ADR-0001 and `docs/architecture.md` §2.3."
- Keep bullet 5: "Downloads are always signed, expiring R2 URLs. Never generate or hardcode a public bucket link."
- Drop bullets 2, 3, 4 and bullet 1's studio half — they moved to `apps/studio/AGENTS.md`.
- Add pointer line: "Studio-specific rules (runtime, service-token auth, provider registry, no-DB) live in `apps/studio/AGENTS.md`."

**Add "Where to read first" table** (replaces the implicit "read docs/PRD.md first" line in the intro):

| Concern | Where |
| --- | --- |
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

**Update "Repo structure & boundaries" ASCII tree** to the annotated template (per ADR-0010 §1, shows the canonical package shape + built-annotation):

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
docs/                # repo-wide: PRD, architecture, tech-stack, plan, progress, adr, libraries,
                     #   models, plans, specs, superpowers, audit-checklist, agents
workflows/           # operational specs of recurring loops
NOTES.md             # raw interview record
CONTEXT-MAP.md       # points at per-context CONTEXT.md files
```

**Add "Planned packages" note** (per ADR-0010 §1, lazy docs policy) under the tree:

> Per-package `AGENTS.md` / `CONTEXT.md` / `docs/adr/` land the day code lands, not before (ADR-0010). Planned: `packages/{db,auth,email,schemas,ui}`, `apps/{store,admin,docs,search}`. Rules that will move when each lands: db-import lock → `packages/db/AGENTS.md`; BetterAuth config contract → `packages/auth/AGENTS.md`; shared-zod-schemas contract → `packages/schemas/AGENTS.md`.

**Add ADR-0010 row to the ADR index** (with Location column — see §4.4 for the full index rewrite).

### 3.5 `CONTEXT-MAP.md` edits

Update the studio line from a TODO to a pointer, and add a planned-packages note:

```markdown
## Contexts

- [API](./apps/api/CONTEXT.md): marketplace backend — catalog, cart, orders, checkout, licenses, coupons, reviews, feedback, BOW documents
- [Studio](./apps/studio/CONTEXT.md): AI generation pipeline (Node, admin/editor-only) — extraction, provider registry, lesson plan, slide generation
- `apps/store`, `apps/admin`, `apps/docs`, `apps/search`: planned — context files land when code lands (ADR-0010)
- `packages/db`: shared Drizzle schema, owned by `api` — CONTEXT.md land when package lands
- `packages/config`, `packages/logger`: infra — no CONTEXT.md (no domain terms, ADR-0010)
```

### 3.6 Verification

Docs-only commit. Render-check each new `AGENTS.md`/`CONTEXT.md` against its outline above. Confirm root `AGENTS.md` no longer references `CLAUDE.md`. Confirm the "Where to read first" table resolves (each path exists or is marked planned).

---

## 4. Commit 3 — Candidate B: `refactor(docs): split ADR locations root vs per-package`

### 4.1 `git mv` ADRs root → `apps/studio/docs/adr/`

Create `apps/studio/docs/adr/` then:

```bash
git mv docs/adr/0002-swappable-ai-provider-registry.md      apps/studio/docs/adr/0002-swappable-ai-provider-registry.md
git mv docs/adr/0003-studio-no-direct-db-access.md          apps/studio/docs/adr/0003-studio-no-direct-db-access.md
git mv docs/adr/0006-slide-content-chained-off-lesson-plan.md apps/studio/docs/adr/0006-slide-content-chained-off-lesson-plan.md
git mv docs/adr/0007-bow-extractions-durable-content-hash.md  apps/studio/docs/adr/0007-bow-extractions-durable-content-hash.md
git mv docs/adr/0008-bow-extraction-normalized-text-hash.md   apps/studio/docs/adr/0008-bow-extraction-normalized-text-hash.md
```

`git mv` preserves rename history (blame follows across the move).

### 4.2 Back-reference stubs at root (5 files)

Each moved ADR leaves a stub at its old root path, format per ADR-0010 §2:

```markdown
# ADR-00NN: <original title>

> **Moved to `apps/studio/docs/adr/00NN-<slug>.md`.** This stub preserves bare-number lookup.

<one-line summary — the "governs" clause> <owner hint>.
```

Concrete stubs:

**`docs/adr/0002-swappable-ai-provider-registry.md`:**

```markdown
# ADR-0002: Swappable AI Provider Registry

> **Moved to `apps/studio/docs/adr/0002-swappable-ai-provider-registry.md`.** This stub preserves bare-number lookup.

AI provider registry — NIM/OpenRouter/Opencode Go, swappable by config. Studio owns this decision; check before adding/changing any AI call inside studio.
```

**`docs/adr/0003-studio-no-direct-db-access.md`:**

```markdown
# ADR-0003: Studio Has No Direct DB Access

> **Moved to `apps/studio/docs/adr/0003-studio-no-direct-db-access.md`.** This stub preserves bare-number lookup.

studio has no Postgres access; goes through api's internal endpoint (service token). Studio owns this decision; check before anything that looks like "just give studio a DB connection for convenience."
```

**`docs/adr/0006-slide-content-chained-off-lesson-plan.md`:**

```markdown
# ADR-0006: Slide Content Chained Off Lesson Plan

> **Moved to `apps/studio/docs/adr/0006-slide-content-chained-off-lesson-plan.md`.** This stub preserves bare-number lookup.

Slide content generated from the lesson plan, not the raw BOW. Studio owns this decision; check before touching studio's slide generation flow or where slide content comes from.
```

**`docs/adr/0007-bow-extractions-durable-content-hash.md`:**

```markdown
# ADR-0007: BOW Extractions Durable, Content-Hash Keyed

> **Moved to `apps/studio/docs/adr/0007-bow-extractions-durable-content-hash.md`.** This stub preserves bare-number lookup.

BOW extractions are durable, api-owned records keyed by content hash. Studio owns the identity computation (producer); api persists it (consumer). Check before changing studio's extraction identity/persistence or `bow_documents`.
```

**`docs/adr/0008-bow-extraction-normalized-text-hash.md`:**

```markdown
# ADR-0008: BOW Extraction Identity = Normalized-Text Hash

> **Moved to `apps/studio/docs/adr/0008-bow-extraction-normalized-text-hash.md`.** This stub preserves bare-number lookup.

BOW extraction identity = normalized-text hash, with a catalog safety net. Studio owns this decision; check before touching studio's extraction identity, cache reuse, or re-download reuse.
```

### 4.3 Annotate ADR-0004 (stays root, moves later)

Add under the Status/Date in `docs/adr/0004-supabase-temporary-db.md`:

```markdown
**Note:** This ADR is `packages/db`-owned. It relocates to `packages/db/docs/adr/0004-supabase-temporary-db.md` when `packages/db` lands (lazy per-app docs policy, ADR-0010).
```

### 4.4 Rewrite root `AGENTS.md` ADR index

Add a **Location** column; point moved rows at per-package paths; annotate 0004; add 0010. Complete index (all ADRs across the repo, per ADR-0010 §2):

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

Update the trailing line: "This table needs to stay in sync — add a row here whenever a new ADR is written **anywhere** (root or per-package), with its Location. See ADR-0010."

### 4.5 Verification

Docs-only commit. After the moves, confirm:

- `apps/studio/docs/adr/` contains 0002, 0003, 0006, 0007, 0008.
- `docs/adr/` still contains 0001, 0004, 0005, 0009, 0010 + the 5 stubs (0002, 0003, 0006, 0007, 0008) + 0000-template.
- Each stub's moved-to path resolves.
- Root ADR index links resolve (each `[NNNN](path)` opens the right file — moved rows point at `apps/studio/docs/adr/`, not the stub).
- `apps/studio/AGENTS.md` "Local ADR index" section (from Commit 2) points at `apps/studio/docs/adr/000N-*` — already consistent.

---

## 5. Commit 4 — Candidate C1: `refactor: dedup node tsconfig flags into config package`

### 5.1 Hoist duplicated flags into `packages/config/src/typescript/node.json`

Current `node.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"]
  }
}
```

New `node.json` (add `target`, `verbatimModuleSyntax`, `skipLibCheck`; `types: ["node"]` already present):

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

> `strict: true` is already in `base.json` — do not re-add it to `node.json`. `base.json`'s `target: ES2025` is overridden by `node.json`'s `target: ESNext` (TS extends: last-write-wins per key), matching current consumer behavior.

### 5.2 Shrink `apps/studio/tsconfig.json`

From:

```json
{
  "extends": "@eduksource/config/ts/node",
  "compilerOptions": {
    "target": "ESNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

To:

```json
{
  "extends": "@eduksource/config/ts/node",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`apps/studio/tsconfig.build.json` unchanged (extends `./tsconfig.json`).

### 5.3 Shrink `packages/logger/tsconfig.json`

From:

```json
{
  "extends": "@eduksource/config/ts/node",
  "compilerOptions": {
    "target": "ESNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

To:

```json
{
  "extends": "@eduksource/config/ts/node",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/logger/tsconfig.build.json` unchanged.

### 5.4 Leave `packages/config/tsconfig.json` alone

It extends `./src/typescript/node.json` directly (not via the package export) and adds `outDir`/`rootDir`/`strictNullChecks`/`noEmit: false`. `strictNullChecks` is already implied by `base.json`'s `strict: true`, so it's redundant but harmless; leave it to avoid scope creep (config package's own tsconfig is a separate concern from the consumer dedup). If desired later, a follow-up can trim `strictNullChecks` and `noEmit: false`.

### 5.5 Verification

```bash
pnpm check-types
pnpm lint
pnpm build:packages
```

All must pass. `check-types` is the load-bearing check — if the hoist dropped or changed a flag TS relies on, it fails here. Compare `tsc --showConfig` output for `apps/studio` and `packages/logger` before and after to confirm the effective config is identical (the hoist must be behavior-preserving).

```bash
# Before Commit 4, capture baseline:
cd apps/studio && npx tsc --showConfig > /tmp/studio-before.json
cd packages/logger && npx tsc --showConfig > /tmp/logger-before.json
# After edits, compare:
cd apps/studio && npx tsc --showConfig > /tmp/studio-after.json
cd packages/logger && npx tsc --showConfig > /tmp/logger-after.json
diff /tmp/studio-before.json /tmp/studio-after.json   # expect no diff
diff /tmp/logger-before.json /tmp/logger-after.json    # expect no diff
```

A clean diff = the hoist is behavior-preserving, exactly the deepening we want (same effective interface, less duplicated surface).

---

## 6. What this deliberately does NOT do

- **No per-package `docs/{PRD,architecture,tech-stack,plan}`.** Single-product monorepo; those describe THE product, stay root (ADR-0010 alternatives).
- **No new root `tsconfig.base.json`.** The config-package seam is already deeper (ADR-0010 §3, C1 over C2).
- **No `CONTEXT.md` for `config`/`logger`.** Infra, no domain terms (ADR-0010 §1).
- **No eager per-package docs for unbuilt packages.** Lazy; land when code lands (ADR-0010 §1).
- **No per-package ADR numbering.** Globally sequential, stable across moves (ADR-0010 §2).
- **No move of ADR-0004 yet.** `packages/db` unbuilt; 0004 annotated "moves when db lands" (ADR-0010 §2).
- **No trim of `packages/config/tsconfig.json`'s redundant `strictNullChecks`/`noEmit: false`.** Separate concern; defer to avoid scope creep (§5.4).

---

## 7. Execution order & PR strategy

Four commits, in order:

1. **Commit 1** — `docs: add ADR-0010 and restructure spec` (this file + ADR-0010)
2. **Commit 2** — Candidate A (per-package docs + root trim)
3. **Commit 3** — Candidate B (ADR relocation + stubs + index)
4. **Commit 4** — Candidate C1 (tsconfig dedup + verify)

PR strategy (trunk-based, one PR per task per root `AGENTS.md`): either **one PR with all 4 commits** (the restructure is one coherent task) or **one PR per commit** (finer review checkpoints). For a solo project where the PR is a review checkpoint, one PR with 4 commits is the default; split only if a review needs to gate Candidate B or C1 independently.

After merge: update `docs/progress.md` to note the restructure landed (Phase 1 Track A housekeeping).
