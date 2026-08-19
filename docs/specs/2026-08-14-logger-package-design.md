# Shared Logger Package Design

## Overview

Extract the logging configuration currently living in `apps/studio/src/config/logger.ts` into a new shared workspace package `packages/logger` (`@eduksource/logger`), so future apps (`api`, `store`, `admin`) and packages (`db`, `auth`) can reuse the same LogLayer + pino setup. The shared factory is configurable by the consuming app; each app keeps its own env wiring.

## Problem Being Solved

`apps/studio/src/config/logger.ts` hard-codes:

- transport composition (pino + pino-pretty),
- level gating based on `env.NODE_ENV` (`'error'` in production, `'debug'` otherwise),
- error serialization (`serialize-error`),
- a silent variant (`createSilentLogger`) used by tests.

This code is app-agnostic except for one line: `env.NODE_ENV`. The monorepo plan calls for more apps/packages that need the same logger. Duplicating it per app invites drift. Moving it to a shared package keeps one source of truth.

## Location Decision

New `packages/logger`, **not** an addition to `packages/config`.

Rationale:

- `packages/config` is build-tooling only (biome/tsconfig/vitest configs) and is installed by every consumer as a **devDependency**. A runtime logger with runtime deps (pino, loglayer, pino-pretty, serialize-error) does not belong there — it would turn a devDependency tooling package into a hybrid runtime library and drag pino into every app's prod dependency graph.
- A dedicated package is a single-purpose unit: create a logger, configure it. It can evolve independently (new transports, PostHog/Datadog) without touching build config.
- A catch-all `packages/utils` is rejected: it becomes a junk drawer. Logging is one concern; give it one package. If a `utils` umbrella is needed later, the logger can be re-homed then.

## Package Layout

```
packages/logger/
  package.json          # name @eduksource/logger, exports ./src/index.ts, runtime deps
  tsconfig.json         # extends @eduksource/config/ts/node, outDir dist
  biome.json            # extends ./node_modules/@eduksource/config/src/biome/base.json
  vitest.config.ts      # extends @eduksource/config/vitest
  src/
    index.ts            # public exports
    logger.ts           # LoggerOptions, logConfig builder, createLogger, createSilentLogger
    logger.test.ts      # moved from apps/studio/src/config/logger.test.ts
```

## Public API

`packages/logger/src/index.ts` exports:

```ts
export { createLogger, createSilentLogger } from './logger.js'
export type { LoggerOptions } from './logger.js'
```

### `createLogger(options?: LoggerOptions): LogLayer`

```ts
export interface LoggerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' // transport gate, default 'debug'
  pretty?: boolean       // pino-pretty stream, default true
  enabled?: boolean      // default true; false → no transports (silent)
}
```

Behavior, preserving current semantics:

- Pino is always opened at `'trace'` so the underlying logger sees every event; per-transport gating is applied via the transport `level` option.
- `createLogger()` with no args behaves exactly like today's `createLogger()` (transport level `'debug'`, pretty on).
- `enabled: false` returns a logger with an empty transport array — the test silent variant.
- `createSilentLogger()` is a convenience wrapper around `createLogger({ enabled: false })`, kept as a named export so existing test imports (`createSilentLogger` from `../config/logger.js`) can be migrated with a one-line change.

Error serialization (`serialize-error`), `contextFieldName`, `metadataFieldName`, `muteContext`, `muteMetadata`, `copyMsgOnOnlyError` are preserved from the current config.

## Consumer Changes: `apps/studio`

`apps/studio/src/config/logger.ts` becomes a thin adapter — it keeps its filename and all current call sites unchanged:

```ts
import { env } from './env.js'
import { createLogger as sharedCreateLogger } from '@eduksource/logger'

export const logger = sharedCreateLogger()
export function createLogger() {
  return sharedCreateLogger({
    level: env.NODE_ENV === 'production' ? 'error' : 'debug',
  })
}
export function createSilentLogger() {
  return sharedCreateLogger({ enabled: false })
}
```

Notes:

- The `env.NODE_ENV → level` mapping stays **in the app**, not the package. The package does not read env.
- `logger` singleton, `createLogger`, `createSilentLogger` exports are preserved, so `src/index.ts`, `src/middlewares/errorHandler.ts`, `src/routes/*`, and the route tests (`extract.test.ts`, `extract.patterns.test.ts`) need no changes.
- `src/config/logger.test.ts` moves to `packages/logger/src/logger.test.ts` (it exercises the shared factory directly); a small adapter test may be added to studio asserting the env→level mapping if desired.

## Monorepo Wiring

- `apps/studio/package.json`: move `@loglayer/transport-pino`, `loglayer`, `pino`, `pino-pretty`, `serialize-error` from `dependencies` to `packages/logger`; add `"@eduksource/logger": "workspace:*"` to studio `dependencies`.
- `packages/logger/package.json`: runtime deps are `@loglayer/transport-pino`, `loglayer`, `pino`, `pino-pretty`, `serialize-error`. Dev deps: `@biomejs/biome`, `@eduksource/config` (workspace), `typescript`, `vitest`, `dotenv`.
- `turbo.json`: add `@eduksource/logger#build` to the `test` task's `dependsOn` alongside `@eduksource/config#build`. The `build` task's `^build` dependency already covers the new package.
- Root `build:packages` filter (`{./packages/*}`) already picks up the new package; worktree init and `pnpm --prod deploy` (Dockerfile) pick it up via workspace wiring.

## Data Flow

1. App (e.g. studio) imports `createLogger` from `@eduksource/logger`.
2. App decides level from its own env and passes `level` in options.
3. Package builds a LogLayer instance: pino at `'trace'` → pretty stream (if enabled) → `PinoTransport` gated at the requested level, `serialize-error` attached.
4. Hono apps feed it to `honoLogLayer` as today; middleware reads `c.var.logger`.

## Error Handling

None new. The logger swallows nothing it doesn't today; transport failures behave as they currently do (pino default). `serialize-error` continues to normalize thrown errors for log output.

## Tests

- Move `apps/studio/src/config/logger.test.ts` → `packages/logger/src/logger.test.ts`. It currently constructs loggers that write to a pretty stream — the test runs with the blob reporter via the shared vitest config.
- Preserve all existing assertions: instance shape, info/warn/error/debug without throwing, error serialization via `withError`, `child()`, `withContext`, `withMetadata`.
- Add a case for `createSilentLogger()` producing no transport (the `enabled: false` path).
- Studio keeps its existing suite green; add (optional) adapter test for the env→level mapping.

## Open Question

None.

## Git Commit

`feat(logger): extract shared logger package with configurable createLogger factory`
