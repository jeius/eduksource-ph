# ADR-0010: Per-Package Docs Locality, ADR Location Split, and Tsconfig Dedup

**Status:** Accepted
**Date:** 2026-08-21

## Context

The repo's root `AGENTS.md` pools rules for every module (studio, api, db, config, logger, ...) into one 11 KB file, far from the code each rule governs. A maintainer touching `apps/studio` reads a root file listing 9 ADRs and 4 apps' rules to find the 3 that apply. The seam for "what contract binds this module" sits at root, not at the module — a shallow pass-through. Apply the deletion test to the package-specific sections of root: delete them and they reappear concentrated in per-package `AGENTS.md` files. That re-concentration is the signal that the current pooling is shallow.

The same pooling applies to ADRs. All 9 ADRs sit at root `docs/adr/`, but 0002 (provider registry), 0003 (studio no-DB), 0006 (slide content), 0007/0008 (BOW extraction identity) are owned by `studio`; 0004 (supabase) is owned by the not-yet-built `packages/db`. A future explorer in `studio` hunts studio reasoning among 9 root files. The seam for "locked decisions binding this module" is at root — shallow.

A milder version of the same drift shows in tsconfigs. `apps/studio/tsconfig.json` and `packages/logger/tsconfig.json` are byte-identical: both extend `@eduksource/config/ts/node` then re-state `target: ESNext`, `strict: true`, `verbatimModuleSyntax`, `skipLibCheck`, and `types: ["node"]` — the latter two already in `node.json`, the former three duplicated across every node-runtime consumer. The shared-config seam (introduced in `677ca18`, `packages/config/src/typescript/{base,node,react,vite}.json` exported via `@eduksource/config/ts/*`) is the right shape; the duplicated flags across consumers are the shallow layer.

The repo is early: only `apps/studio`, `packages/config`, `packages/logger` have code; `apps/api` has a `CONTEXT.md` and a finalized modular-monolith spec but no `src/`. Moving text now is nearly free; waiting until packages accumulate code makes the same restructure expensive.

## Decision

**1. Per-package docs policy (lazy).** Each app/package gets its own `AGENTS.md` (package-specific engineering rules + tool contracts) and `CONTEXT.md` (domain glossary), located at the package root. Root `AGENTS.md` keeps only cross-cutting rules (commands, conventions, commit style, cross-package boundaries, the ADR index, a "where to read first" pointer table). `CONTEXT.md` is created lazily — only when a module accrues domain terms worth pinning; infra packages (`config`, `logger`) skip it unless terms appear. Per-package docs for unbuilt packages (`db`, `auth`, `email`, `schemas`, `ui`, `store`, `admin`, `docs`, `search`) land the day code lands, not before — rules for code that doesn't exist have no locality to sit in and risk freezing decisions before the justifying code exists. Root `AGENTS.md` keeps a "planned packages" note listing where each rule is going.

**2. ADR location split.** An ADR lives with the package that owns the decision; repo-wide or truly cross-package ADRs stay root. Owner = the package whose code the decision primarily constrains; if it truly constrains two equally, it stays root. Globally sequential numbering across the whole repo (next ADR anywhere = `0011`); cross-references use the bare number, location resolves scope. When an ADR relocates, a back-reference stub remains at its old root path preserving the bare-number lookup: a pointer to the new path plus a one-line summary and an owner hint, no content duplication.

ADR-0004 (supabase) stays root until `packages/db` lands, then moves to `packages/db/docs/adr/` with a stub at root.

ADR-0007/0008 (BOW extraction identity) move to `apps/studio/docs/adr/`: studio is the producer of the identity; `api` is a consumer of the contract, recorded in the ADR body, not implied by location.

Root `AGENTS.md` keeps a **complete** ADR index (all ADRs across the repo) with a Location column, so a root-scanner finds any settled decision without hunting per-package dirs. Per-package `AGENTS.md` keeps its own scoped index for in-package reading.

**3. Tsconfig dedup (deepen the existing config-package seam, no new root file).** Hoist the duplicated flags (`target: ESNext`, `verbatimModuleSyntax`, `skipLibCheck`, `types: ["node"]`) into `packages/config/src/typescript/node.json`. Node-runtime consumers (`apps/studio`, `packages/logger`) shrink to `{extends, rootDir, outDir, include, exclude}`. Do **not** introduce a root `tsconfig.base.json`; the config-package seam (biome + tsconfig + vitest, exported via `@eduksource/config/*`) is already deeper than a bare root file. A second shared-config location would re-litigate `677ca18` without a reason. Runtime-specific overrides (workers lib/types when `api`/`store`/`admin` land) stay per-app, extending the runtime-appropriate `@eduksource/config/ts/<runtime>.json`.

## Alternatives Considered

- **Eager per-package docs for every planned package now** — rejected. Rules invented for unbuilt code drift, and an `AGENTS.md` describing a module that doesn't exist violates "the interface is the test surface" — there's no module to test against. Lazy keeps the pattern honest.
- **Keep all ADRs at root** — rejected. Defeats locality for studio/db, the two modules with the most ADRs (5 and 1 respectively). Root index stays complete, so discoverability is preserved.
- **Split ADR numbering per-location (studio starts at 0001)** — rejected. Globally sequential numbers are stable across moves and unambiguous in cross-references; per-location numbering re-collides and breaks "don't re-litigate" lookup.
- **Keep ADR-0007/0008 at root as the cross-package exception** — rejected. The *decision* (how studio computes extraction identity) is studio-owned; `api`'s persistence clause is a consumer contract, recorded in the body. Splitting them from the other 3 studio ADRs would scatter studio reasoning across two locations.
- **New root `tsconfig.base.json` (reference-monorepo style)** — rejected. Re-litigates `677ca18` without a friction signal; the config-package seam already exports the shared base and is deeper (one seam for biome+tsconfig+vitest). Aligning to a *different* repo's style is not a real friction signal here.
- **Per-package `docs/{PRD,architecture,tech-stack,plan}` (reference style)** — rejected. This is a single-product monorepo; those docs describe THE product, stay root. A per-package `architecture.md` may be split later only where internals strain (e.g. studio); deferred until strain is real.

## Consequences

**Gets easier:**

- **Locality.** A maintainer in `apps/studio/` reads `studio/AGENTS.md` + `studio/CONTEXT.md` without bouncing to root. Rules sit next to the code they govern.
- **Leverage.** An agent scoped to one package gets exactly that package's contract, not the whole repo's. Smaller context, fewer wrong-module assumptions (e.g. an agent in `studio` won't reach for `packages/db` because the rule lives in its own `AGENTS.md`).
- **Test surface.** Per-package `AGENTS.md` states invariants ("studio never imports `packages/db`", "downloads are signed expiring R2 URLs", "AI calls go through the registry") — reviews and tests check those claims at the seam.
- **ADR discoverability.** Complete root index with Location column; a settled decision is findable from root without knowing which package owns it.
- **Tsconfig maintenance.** Node-runtime strict baseline changes once in `node.json`; every node consumer inherits it. Per-package tsconfigs shrink to localities.
- **Cheap now.** Only 3 packages have code; the restructure is mostly text moves.

**Gets harder / new obligations:**

- **Two doc locations to keep in sync.** When a decision moves package, its `AGENTS.md` and the root index both need updating. The back-ref stub mitigates: the relocated file is the single source of truth; the stub is a signpost, not a copy, so there's nothing to drift.
- **Discipline for "which ADR location."** The owner-rule needs judgment for cross-package ADRs (0007/0008 set the precedent: producer owns, consumer clause in body). Future cross-package ADRs need the same call made explicitly.
- **Complete root index grows.** Today 9 rows; grows with every ADR anywhere. Cheap (one row per decision) but needs the "add a row when you write an ADR" habit to extend to per-package ADRs too.
- **Per-package `AGENTS.md` can go stale** if a package's contract changes without its `AGENTS.md` being touched. Same risk as root today, just distributed. Mitigated by the review checkpoint (trunk-based, one PR per task) catching drift.
- **ADR-0004's move is deferred**, so its "moves when db lands" intent must be remembered. Recorded inline in 0004 and in the root index Location column.

## Relocations under this ADR

- ADR-0002 → `apps/studio/docs/adr/0002-swappable-ai-provider-registry.md` (stub at root)
- ADR-0003 → `apps/studio/docs/adr/0003-studio-no-direct-db-access.md` (stub at root)
- ADR-0006 → `apps/studio/docs/adr/0006-slide-content-chained-off-lesson-plan.md` (stub at root)
- ADR-0007 → `apps/studio/docs/adr/0007-bow-extractions-durable-content-hash.md` (stub at root)
- ADR-0008 → `apps/studio/docs/adr/0008-bow-extraction-normalized-text-hash.md` (stub at root)
- ADR-0004 → stays root (`docs/adr/0004-supabase-temporary-db.md`), annotated "moves to `packages/db/docs/adr/` when `packages/db` lands"
- ADR-0001, 0005, 0009 → stay root (genuinely repo-wide)
