# AGENTS.md

Operational notes for OpenCode sessions. Read `CLAUDE.md` (working conventions) and `PROJECT_PLAN.md` (roadmap) for context, but beware the drift below.

## The single most important fact

`PROJECT_PLAN.md` and `CLAUDE.md` describe the *future* monorepo (`store`, `admin`, `api`, `docs` apps; `ui`, `db`, `auth`, `email`, `schemas` packages). **None of those exist yet.** The repo today is only:

- `apps/studio` — Hono + Node.js service that converts DepEd Budget-of-Work PDFs into lesson plans, PPTX, DOCX, and summative tests (internal admin tool). This is the active project; see `apps/studio/STUDIO_PLAN.md`.
- `packages/config` — shared tsconfig / biome / vitest config.
- `scripts/clean-worktrees.mjs` — worktree cleanup utility.

Do not assume plan apps exist; do not scaffold against the plan unless the task explicitly asks for it.

## Studio is Node.js, NOT Cloudflare Workers

`STUDIO_PLAN.md` §2 deliberately chose Node over Workers (memory/CPU limits break PDF/PPTX/DOCX libs). The "no Node-only APIs, Workers-only" rules in `CLAUDE.md` §API apply to the *future* `api` app, **not** `apps/studio`. Node APIs (`fs`, `net`, native modules) are fine and expected in studio.

## Commands

Root scripts (verified from `package.json`; note there is **no** `pnpm typecheck` — it's `check-types`):

```bash
pnpm install            # workspaces; pnpm only, never npm/yarn
pnpm dev                # turbo run dev (studio: tsx --env-file=.env --watch)
pnpm dev --filter=studio
pnpm build              # turbo build
pnpm build:packages     # builds packages/* (needed before vitest config works — see below)
pnpm check-types        # tsc --noEmit per workspace (NOT "typecheck")
pnpm lint               # turbo run lint (biome)
pnpm fix                # biome check --write (per workspace, e.g. --filter=studio)
pnpm test               # turbo run test
pnpm test:projects      # vitest run directly (root)
pnpm report             # merge vitest blob reports -> coverage/report/index.html
pnpm build:docker:studio
```

Studio-local (run via `--filter=studio` or inside `apps/studio`): `dev`, `build` (tsc), `start` (`node --env-file=.env dist/index.js`), `test`, `lint`, `format`, `fix`.

## Env & runtime gotchas

- `apps/studio/.env` is **required** for dev/start/tests and is gitignored; **no `.env.example` exists**. Copy an existing `.env` or create one with `NVIDIA_API_KEY`, `PORT`, `NODE_ENV` (schema in `src/config/env.ts`).
- Env is parsed eagerly at import time by Zod — missing required vars crash immediately.
- Tests load `.env` via the shared vitest `setupFiles: ['dotenv/config']`.
- Server entry (`src/index.ts`) only binds a port under `import.meta.main`, so tests can import the Hono app without a listener.
- Node >= 24, pnpm 11.21.0 (corepack), TypeScript 6, Zod 4, Hono 4.

## TypeScript / ESM style

- `verbatimModuleSyntax` → always `import type` for type-only imports.
- ESM `"type": "module"` → relative imports must use `.js` extensions (`import { env } from './config/env.js'`).
- Strict mode everywhere; biome `noExplicitAny` is a **warning** (not error).

## Testing (vitest)

- Shared config `@eduksource/config/vitest` (exports from `dist/` → **build `@eduksource/config` first**, or `pnpm build:packages`, or turbo handles it via `dependsOn`).
- Blob reporter is on by default: every `vitest run` writes `coverage/blob/report.json`; `pnpm report` merges them into an HTML report.
- Test files live next to source (`src/**/*.test.ts`); `tsconfig.build.json` excludes them.
- Real BOW PDF fixtures live in `apps/studio/tests/fixtures/` — use these rather than inventing test data for PDF extraction.

## Biome conventions

Single quotes, **no semicolons**, 2-space indent, 100-col line width, es5 trailing commas. `noFloatingPromises` is an error. Run `pnpm fix` before finishing. Config extends `packages/config/biome/base.json`.

## Deploy

`apps/studio` deploys to **Fly.io** (`apps/studio/fly.toml`, app `eduksource-studio`, region `sin`), scale-to-zero (min machines 0, auto-stop). Build: `pnpm build:docker:studio` or `fly deploy`; Dockerfile uses turbo prune + `pnpm --prod deploy`. Health check on `/health`.

## Worktree workflow

Dev work uses git worktrees in `.dev/worktrees/` (gitignored), with branches named `worktree-*` (see existing branches). Helpers: `pnpm dev:worktree:init` (`pnpm install && pnpm build:packages`) and `pnpm dev:worktree:clean` (`node scripts/clean-worktrees.mjs`, `DRY_RUN=1` to preview).

## Docs & reference

- `apps/studio/STUDIO_PLAN.md` — source of truth for studio scope/decisions (overrides generic plan for studio work).
- `docs/` — per-library notes (`HONO.md`, `LOG_LAYER.md`), model notes (`QWEN_IMAGE.md`), and `docs/superpowers/` plans/specs for feature work.
- `graphify-out/` — knowledge graph; run `graphify update .` after code changes (per CLAUDE.md).
- No CI workflows, no `opencode.json`, and no `AGENTS.md` existed before this file.
