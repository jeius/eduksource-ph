# packages/config — Shared Config (Biome, TypeScript, Vitest)

Exports shared tooling config for the monorepo.

## What this package exports

- `@eduksource/config/ts/*` — TypeScript configs: `base.json`, `node.json`, `react.json`, `vite.json` (src/typescript/)
- `@eduksource/config/biome/*` — Biome configs (src/biome/)
- `@eduksource/config/vitest` — Vitest shared config

## Rules

- Packages extend the runtime-appropriate `@eduksource/config/ts/<runtime>.json` and import biome config from here. Don't hand-roll a tsconfig or biome config in a package.
- Shared strict-baseline changes land in `packages/config/src/typescript/{base,node,react,vite}.json`, not duplicated per consumer. See ADR-0010.
- No domain vocabulary — no CONTEXT.md (infra, per ADR-0010). See root `AGENTS.md` and `CONTEXT-MAP.md`.

## Pointer to root

Cross-cutting (commands, conventions, commit style) → root `AGENTS.md`.
