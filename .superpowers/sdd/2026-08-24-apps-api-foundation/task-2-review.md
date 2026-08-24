# Task 2 Review — `packages/schemas` (SDD task-reviewer)

**Reviewer:** subagent (task-reviewer)
**Branch reviewed:** `hermes-subagent/subagent-sa-0-40069015` @ `fb30193`
**Focus:** Task 2 commits `9d20fd6`..`fb30193` (packages/schemas + pnpm-lock zod entry)
**Spec source:** task-2-brief.md (verbatim brief); global constraints: term-not-quarter, strand/topic filters, 64-hex, schoolYear required.

## Verdict

- **Spec compliance: ✅ PASS** — every Zod schema/field/constraint matches the brief verbatim.
- **Quality: ❌ NEEDS FIX** — the committed `pnpm-lock.yaml` does not include `packages/schemas`; `pnpm install --frozen-lockfile` fails. CI reproducibility is broken.

**Fix round needed? YES** — regenerate the lockfile so `packages/schemas` is present (with `zod@4.4.3`), then re-verify `pnpm install --frozen-lockfile` exits 0.

## Strengths

- `catalog.ts` matches the brief field-for-field:
  - `CatalogCreateSchema` — 9 fields with exact constraints: `slug` `/^[a-z0-9-]+$/`, `title` min1/max500, `description` max5000 optional, `gradeLevel`/min1/max50, `subject` min1/max100, `term` min1/max100, `r2Key` min1/max500, `versionNote` max2000 optional, `status` enum `['draft','published']` default `'draft'` optional (catalog.ts:3-13).
- `CatalogFiltersSchema` honors global constraints: `term` (not `quarter`), `strand` and `topic` filters both present, `status` enum includes `'archived'`, `limit` `z.coerce.number().int().min(1).max(100).default(20).optional()`, `cursor` optional (catalog.ts:15-24).
- `CatalogIdParamsSchema` = `id: z.coerce.number().int().positive()`; `CatalogCreateInput` exported (catalog.ts:26-27).
- `bow-documents.ts`: `BowCreateSchema` 64-hex `contentHash` with message `'contentHash must be 64-char hex'`, `schoolYear` required (min1/max20); `BowParamsSchema` 64-hex `contentHash` (bow-documents.ts:3-14). All constraints match brief.
- `index.ts` barrel uses `.js` specifiers (required by `nodenext` + `verbatimModuleSyntax` from `@eduksource/config/ts/node`) — consistent with repo tooling (index.ts:1-2).
- `package.json`: private, `type: module`, `build` = `tsc --project tsconfig.build.json`, `check-types` = `tsc --noEmit`, `exports` map points at `dist`, `zod` `^4.4.3` aligned with `apps/studio` (package.json:7-13,23-24). Mirrors `packages/{db,logger}` conventions; extends `@eduksource/config/ts/node` (no hand-rolled tsconfig) per `packages/config/AGENTS.md`.

## Issues

### Critical
- **`pnpm-lock.yaml` missing `packages/schemas` importer (lockfile drift).** The `importers:` block (lines 8-178) lists `apps/api`, `apps/studio`, `packages/config`, `packages/db`, `packages/logger` — but **no `packages/schemas` entry**, even though `packages/schemas/package.json` declares 6 deps (`zod`, `@eduksource/config`, `@biomejs/biome`, `@types/node`, `typescript`, `vitest`). Verified:
  ```
  $ pnpm install --frozen-lockfile --lockfile-only
  [ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because pnpm-lock.yaml
  is not up to date with <ROOT>/packages/schemas/package.json
    specifiers in the lockfile don't match specifiers in package.json:
  * 6 dependencies were added: @biomejs/biome@2.5.7, @eduksource/config@workspace:*,
    @types/node@^26.2.0, typescript@^6.0.3, vitest@^4.1.10, zod@^4.4.3
  ```
  CI (which sets `--frozen-lockfile` by default) will fail to install. `zod@4.4.3` exists in `packages:` (line 2386) but is not wired to the schemas importer.
- **Report is inaccurate (commit `1ab51c1`).** Report line 9/35 claims "add zod to workspace lockfile for @eduksource/schemas" registered zod for the package. `git show 1ab51c1` shows it only *shuffles* importers (drops `apps/api`, adds `packages/db`) and never adds a `packages/schemas` importer — so the schemas package is still absent from the lockfile. The report's self-review is therefore misleading; do not rely on it for sign-off.

### Important
- None beyond the Critical lockfile drift (the build/check-types "pass" in the report only ran because a non-frozen local `pnpm install` regenerates the lockfile on the fly; the *committed* lockfile is still stale).

### Minor
- `CatalogCreateSchema.description` caps at `max(5000)` (catalog.ts:6) while the `products` table column `description` is unbounded `text` (diff line 97). Schemas are API input constraints and may legitimately be stricter than the column, so this is not a bug — just note the intentional divergence; confirm `max(5000)` is the desired API limit vs. DB.
- Package version `0.0.0` (package.json:3) matches sibling packages; fine. `license: MIT` on a `private` package is consistent with repo norm.

## Action for fix round
1. In the worktree: `pnpm install` (regenerates `pnpm-lock.yaml` adding the `packages/schemas` importer with `zod@4.4.3`).
2. `pnpm install --frozen-lockfile` must now exit 0.
3. Re-run `pnpm --filter @eduksource/schemas build` and `check-types` (need `packages/logger`/`packages/config` built for full-workspace `check-types`; the schemas `build`/`check-types` filter is independent).
4. Commit the regenerated `pnpm-lock.yaml`. No Zod source changes required.

## Bottom line
Spec: PASS (source verbatim-correct). Quality: FAIL on lockfile drift — the committed tree will not install under `--frozen-lockfile`, blocking CI. Fix round required (lockfile only).
