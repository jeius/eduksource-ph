# Shared Logger Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract studio's LogLayer + pino logger into a new configurable `@eduksource/logger` workspace package.

**Architecture:** New `packages/logger` owns the logger factory (`createLogger({ level, pretty, enabled })`), error serialization, and a silent variant. `apps/studio` keeps a thin `src/config/logger.ts` adapter that maps its own `env.NODE_ENV` to a level and passes it in — the package never reads env. All existing studio call sites (`index.ts`, `errorHandler.ts`, route tests) keep their current imports unchanged.

**Tech Stack:** LogLayer (v9), pino (v10) + pino-pretty (v13), `@loglayer/transport-pino` (v3), `serialize-error` (v13), tsc (NodeNext ESM), vitest (v4), turbo.

**Spec:** `docs/specs/2026-08-14-logger-package-design.md`

## Global Constraints

- Single quotes, no semicolons, 2-space indent, 100-col line width, es5 trailing commas (inherited biome base).
- `verbatimModuleSyntax` → `import type` for type-only imports.
- ESM (`"type": "module"`), NodeNext → relative imports must use `.js` extensions (`./logger.js`).
- Runtime deps live in the package (`dependencies`), never in the consuming app.
- The env → level mapping (`NODE_ENV === 'production' ? 'error' : 'debug'`) stays in the app. The package takes level as an option and never imports any app env.
- `@eduksource/config/vitest` exports from `dist/` → build `@eduksource/config` (or run `pnpm build:packages`) before running any vitest that imports it.
- Tests live next to source (`src/**/*.test.ts`); a `tsconfig.build.json` excludes them from `dist`.
- `pnpm --filter <pkg> <script>` for per-workspace commands; pnpm only, never npm/yarn.
- Studio keeps `@loglayer/hono` as a direct dependency (used by `src/index.ts`, `src/lib/types.ts`, route tests).

---

### Task 1: Scaffold `packages/logger` and implement the factory

**Files:**

- Create: `packages/logger/package.json`
- Create: `packages/logger/tsconfig.json`
- Create: `packages/logger/tsconfig.build.json`
- Create: `packages/logger/biome.json`
- Create: `packages/logger/vitest.config.ts`
- Create: `packages/logger/src/logger.ts`
- Create: `packages/logger/src/index.ts`
- Create: `packages/logger/src/logger.test.ts`

**Interfaces:**

- Consumes: nothing (first task). Imports `@eduksource/config` (tsconfig/biome/vitest base) as devDependency.
- Produces:
  - `createLogger(options?: LoggerOptions): LogLayer`
  - `createSilentLogger(): LogLayer`
  - `interface LoggerOptions { level?: 'trace'|'debug'|'info'|'warn'|'error'|'fatal'; pretty?: boolean; enabled?: boolean }`
  - package export path `@eduksource/logger` → `dist/index.js` + `dist/index.d.ts`

- [ ] **Step 1: Create `packages/logger/package.json`**

```json
{
  "name": "@eduksource/logger",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc --project tsconfig.build.json",
    "check-types": "tsc --noEmit",
    "lint": "pnpx @biomejs/biome lint",
    "format": "pnpx @biomejs/biome format",
    "fix": "pnpx @biomejs/biome check --write .",
    "test": "vitest run"
  },
  "dependencies": {
    "@loglayer/transport-pino": "^3.3.0",
    "loglayer": "^9.4.0",
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3",
    "serialize-error": "^13.0.1"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.7",
    "@eduksource/config": "workspace:*",
    "@types/node": "^26.2.0",
    "dotenv": "^16.4.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `packages/logger/tsconfig.json`**

```json
{
  "extends": "./node_modules/@eduksource/config/typescript/node.json",
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

- [ ] **Step 3: Create `packages/logger/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "node_modules", "dist"]
}
```

- [ ] **Step 4: Create `packages/logger/biome.json`**

```json
{
  "root": false,
  "extends": ["./node_modules/@eduksource/config/biome/base.json"]
}
```

- [ ] **Step 5: Create `packages/logger/vitest.config.ts`**

```ts
import { baseConfig } from '@eduksource/config/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig(baseConfig)
```

- [ ] **Step 6: Build the config package so vitest can resolve its dist exports**

Run: `pnpm --filter @eduksource/config build`
Expected: `packages/config/dist/` populated (needed for `@eduksource/config/vitest` import above).

- [ ] **Step 7: Write the failing test `packages/logger/src/logger.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createLogger, createSilentLogger } from './logger.js'

describe('logger', () => {
  const log = createLogger()

  it('exports logger instance', () => {
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
  })

  it('logs info level without throwing', () => {
    expect(() => log.info('test info message')).not.toThrow()
  })

  it('logs warn level without throwing', () => {
    expect(() => log.warn('test warn message')).not.toThrow()
  })

  it('logs error level with error serialization without throwing', () => {
    const error = new Error('test error')
    expect(() =>
      log.withPrefix('[SYSTEM]').withError(error).error('test error message')
    ).not.toThrow()
  })

  it('logs debug level without throwing', () => {
    expect(() => log.debug('test debug message')).not.toThrow()
  })

  it('supports child loggers with context', () => {
    const childLog = log.child()
    expect(childLog).toBeDefined()
    expect(() => childLog.info('child logger message')).not.toThrow()
  })

  it('supports withContext', () => {
    const contextLog = createLogger().withContext({ requestId: '123' })
    expect(contextLog).toBeDefined()
    expect(() => contextLog.info('context message')).not.toThrow()
  })

  it('supports withMetadata', () => {
    const metaLog = createLogger().withMetadata({ username: 'Jeius' })
    expect(metaLog).toBeDefined()
    expect(() => metaLog.info('metadata message')).not.toThrow()
  })

  it('createSilentLogger produces a logger with no transport', () => {
    const silent = createSilentLogger()
    expect(silent).toBeDefined()
    expect(() => silent.info('silent message')).not.toThrow()
    expect(() => silent.error('silent error')).not.toThrow()
  })

  it('createLogger accepts a custom level', () => {
    const errorLog = createLogger({ level: 'error' })
    expect(errorLog).toBeDefined()
    expect(() => errorLog.error('error only message')).not.toThrow()
  })
})
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter @eduksource/logger test`
Expected: FAIL — import resolution error for `./logger.js` (module not found).

- [ ] **Step 9: Implement `packages/logger/src/logger.ts`**

```ts
import { PinoTransport } from '@loglayer/transport-pino'
import { LogLayer, type LogLayerConfig } from 'loglayer'
import { pino } from 'pino'
import pretty from 'pino-pretty'
import { serializeError } from 'serialize-error'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LoggerOptions {
  level?: LogLevel
  pretty?: boolean
  enabled?: boolean
}

const DEFAULT_LEVEL: LogLevel = 'debug'

function buildConfig(options: Required<LoggerOptions>): LogLayerConfig {
  const base = {
    errorSerializer: serializeError,
    contextFieldName: 'context',
    metadataFieldName: 'metadata',
    muteContext: false,
    muteMetadata: false,
    copyMsgOnOnlyError: true,
  }

  if (!options.enabled) {
    return { ...base, transport: [] }
  }

  const stream = options.pretty
    ? pretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      })
    : undefined

  const p = pino({ level: 'trace' }, stream)

  return {
    ...base,
    transport: [
      new PinoTransport({
        enabled: true,
        logger: p,
        level: options.level,
      }),
    ],
  }
}

export function createLogger(options: LoggerOptions = {}): LogLayer {
  const resolved: Required<LoggerOptions> = {
    level: options.level ?? DEFAULT_LEVEL,
    pretty: options.pretty ?? true,
    enabled: options.enabled ?? true,
  }
  return new LogLayer(buildConfig(resolved))
}

export function createSilentLogger(): LogLayer {
  return createLogger({ enabled: false })
}
```

- [ ] **Step 10: Implement `packages/logger/src/index.ts`**

```ts
export { createLogger, createSilentLogger } from './logger.js'
export type { LoggerOptions, LogLevel } from './logger.js'
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter @eduksource/logger test`
Expected: PASS — all 10 cases green. (Blob report written to `coverage/blob/report.json`.)

- [ ] **Step 12: Verify types, lint, and build**

Run:

```bash
pnpm --filter @eduksource/logger check-types
pnpm --filter @eduksource/logger lint
pnpm --filter @eduksource/logger build
```

Expected: all pass; `packages/logger/dist/index.js` and `dist/index.d.ts` emitted; no `logger.test.js` in `dist/`.

- [ ] **Step 13: Commit**

```bash
git add packages/logger
git commit -m "feat(logger): add shared logger package with createLogger factory"
```

---

### Task 2: Wire the package into the monorepo and migrate studio

**Files:**

- Modify: `turbo.json:20-24` (add logger build to `test` task `dependsOn`)
- Modify: `apps/studio/package.json` (swap dependencies)
- Modify: `apps/studio/src/config/logger.ts` (rewrite as thin adapter)
- Delete: `apps/studio/src/config/logger.test.ts` (moved to package)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Consumes: `createLogger`, `createSilentLogger` from `@eduksource/logger` (Task 1).
- Produces: studio's `src/config/logger.ts` re-exports the same surface it had before — `logger` singleton, `createLogger()`, `createSilentLogger()` — so `src/index.ts`, `src/middlewares/errorHandler.ts`, `src/routes/*`, and route tests compile unchanged.

- [ ] **Step 1: Add `@eduksource/logger#build` to the turbo `test` task**

In `turbo.json`, change the `test` task so its `dependsOn` becomes:

```json
"test": {
  "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/vitest.config.ts"],
  "dependsOn": ["transit", "@eduksource/config#build", "@eduksource/logger#build"],
  "outputs": ["coverage/blob/**"]
}
```

(`build` and `check-types` tasks already cover the new package via their `^build` / `^check-types` dependsOn.)

- [ ] **Step 2: Update `apps/studio/package.json` dependencies**

Remove from `dependencies` (they now live in the package):

```json
"@loglayer/transport-pino",
"loglayer",
"pino",
"pino-pretty",
"serialize-error"
```

Add to `dependencies`:

```json
"@eduksource/logger": "workspace:*"
```

Keep `@loglayer/hono` — studio still imports it directly (`src/index.ts`, `src/lib/types.ts`, route tests).

- [ ] **Step 3: Rewrite `apps/studio/src/config/logger.ts` as the adapter**

Replace the entire file contents with:

```ts
import { createLogger as sharedCreateLogger } from '@eduksource/logger'
import { env } from './env.js'

const level = env.NODE_ENV === 'production' ? 'error' : 'debug'

export const logger = sharedCreateLogger({ level })

export function createLogger() {
  return sharedCreateLogger({ level })
}

export function createSilentLogger() {
  return sharedCreateLogger({ enabled: false })
}
```

- [ ] **Step 4: Delete `apps/studio/src/config/logger.test.ts`**

Run: `rm apps/studio/src/config/logger.test.ts`
Reason: the test moved to `packages/logger/src/logger.test.ts` in Task 1.

- [ ] **Step 5: Refresh the lockfile**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` updated; `apps/studio/node_modules/@eduksource/logger` symlinked (workspace injection).

- [ ] **Step 6: Verify studio — types, tests, build, lint**

Run:

```bash
pnpm --filter @eduksource/studio check-types
pnpm --filter @eduksource/studio test
pnpm --filter @eduksource/studio build
pnpm --filter @eduksource/studio lint
```

Expected: all pass. No test imports `../config/logger.js` any longer (the `createSilentLogger` imports in `src/routes/extract.test.ts` and `src/routes/extract.patterns.test.ts` still resolve via the adapter).

- [ ] **Step 7: Commit**

```bash
git add turbo.json apps/studio/package.json apps/studio/src/config/logger.ts pnpm-lock.yaml
git commit -m "refactor(studio): consume shared logger package, keep env-level adapter"
```

---

### Task 3: Full-repo verification

**Files:**

- Modify: none (verification only)

**Interfaces:**

- Consumes: everything from Tasks 1–2.

- [ ] **Step 1: Build all packages and type-check the repo**

Run:

```bash
pnpm build:packages
pnpm check-types
```

Expected: both pass. `packages/logger` builds before studio in turbo's dependency graph.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all workspaces pass; blob reports merged per workspace.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: clean. If biome reports style violations in the new package, fix with `pnpm --filter @eduksource/logger fix` and re-run.

- [ ] **Step 4: Commit any lint fix-ups**

Only if Step 3 changed files:

```bash
git add -A
git commit -m "style(logger): apply biome fixes"
```

## Self-Review Notes

- Spec coverage: factory + options API → Task 1; silent variant + level option → Task 1 tests; studio adapter keeping filename/call sites → Task 2 Step 3; env mapping stays in app → Task 2 Step 3; turbo wiring → Task 2 Step 1; runtime deps move to package → Task 2 Step 2; `logConfig` dropped (internal-only, verified no external consumers) → Task 2 Step 3.
- No placeholders; every step carries exact code or command.
- Type consistency: `LoggerOptions`, `createLogger`, `createSilentLogger` names match across Task 1 (definition + tests) and Task 2 (adapter imports). Export path `@eduksource/logger` → `dist/index.js` matches the package.json `exports` map.
