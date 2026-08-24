# Final Fix Report — MUST FIX F1–F4 (review cbb3ae8)

**Status:** ✅ Complete
**Commit:** `fa2d9ac` — `fix(api): final review — transaction, workspace, draft default, barrel`
**Branch:** `hermes-subagent/subagent-sa-0-4e8bc555` (worktree, not pushed)
**Model:** openrouter/stealth/ox-alpha

## Fixes applied

- **F1 Transaction:** `apps/api/src/modules/catalog/service.ts` `createProduct` now wraps both inserts in `db.transaction(async (tx) => ...)` using `tx.insert`. Returns `{ product, version }` unchanged. A productVersions failure throws inside the transaction → product insert rolls back (orphan test would pass).
- **F2 pnpm-workspace.yaml:** replaced placeholder `workerd: set this to true or false` with `workerd: true`. `pnpm install --frozen-lockfile` passes (3.4s, lockfile untouched).
- **F3 Draft-leak:** `service.ts listProducts` defaults to `eq(products.status, 'published')` when `filters.status` is undefined. `catalog.test.ts` GET /products test now asserts every returned product has `status === 'published'`.
- **F4 Barrel + docs:** removed `export * as service from './service.js'` from `apps/api/src/modules/bow-documents/index.ts` (AGENTS.md rule 3). `docs/progress.md` "(filters + cursor pagination)" → "(filters + limit pagination)".

## Verification

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `tsc --noEmit` (apps/api) | pass, no errors |
| `biome check apps/api/src` | clean (2 files auto-formatted: transaction indentation + pre-existing app.test.ts formatting) |
| `vitest run src` | **16/16 passed**, 4 files (real Supabase via `app.request()`) |

## Self-review

- F1 keeps the same return contract; error semantics unchanged for callers.
- F3 minimal fix per instructions (service-level default). Note: stub auth sets role admin always, so admin callers currently can't list drafts without `?status=draft` explicitly — acceptable per task scope; role-based derivation is a follow-up when real auth lands.
- F4 barrel removal verified against AGENTS.md rule 3 (`index.ts` re-exports routes/port only). No other module imported `bow-documents.service`.
- Biome check initially flagged formatting after the transaction refactor; fixed with `--write`, re-verified tsc + tests before amending commit.

## Concerns

- None blocking. Follow-ups noted above (role-aware status default; explicit orphan-rollback integration test would require fault injection).
