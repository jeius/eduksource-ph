# `@eduksource/logger` — Shared Logger Package

Shared, configurable logger for all apps and packages in the monorepo. Wraps **LogLayer** + **pino** + **pino-pretty**, with error serialization via `serialize-error`.

The package is env-agnostic by design: it takes all configuration as options. **Each consuming app decides its own log level from its own env** and passes it in — the package never reads `process.env`.

## Installation

```bash
pnpm --filter <app> add @eduksource/logger
```

`@eduksource/logger` is a runtime `dependency` (not devDependency). It owns `loglayer`, `pino`, `pino-pretty`, `@loglayer/transport-pino`, and `serialize-error` internally — consumers never install those directly.

## Public API

Everything the package exports, from `packages/logger/src/index.ts`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `createLogger(options?)` | function | Returns a configured `LogLayer` instance |
| `createSilentLogger()` | function | Returns a `LogLayer` with no transport (tests) |
| `LoggerOptions` | type | Options accepted by `createLogger` |
| `LogLevel` | type | Union of valid log levels |

### `createLogger(options?: LoggerOptions): LogLayer`

Builds a `LogLayer` instance. Returns the same type as `new LogLayer(...)`, so all of LogLayer's fluent API is available: `info`, `warn`, `error`, `debug`, `trace`, `fatal`, `withContext`, `withMetadata`, `withError`, `withPrefix`, `child`, etc.

```ts
import { createLogger } from '@eduksource/logger'

const log = createLogger()
log.info('Hello')
log.withError(err).error('Request failed')
```

### `createSilentLogger(): LogLayer`

Returns a logger with an empty transport array — logs are accepted and dropped. Intended for tests where you need a real `LogLayer` instance (so `c.var.logger` is defined) without writing to stdout.

```ts
import { createSilentLogger } from '@eduksource/logger'

const app = new Hono()
app.use(honoLogLayer({ instance: createSilentLogger() }))
```

### `LoggerOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `'debug'` | Gate for the pino transport. Events below this level are still emitted to pino but not written. |
| `pretty` | `boolean` | `true` | Pipe pino through `pino-pretty` (human-readable, colorized). Set `false` for machine-readable JSON (e.g. prod log aggregation). |
| `enabled` | `boolean` | `true` | `false` produces a logger with no transport (identical to `createSilentLogger()`). |

### `LogLevel`

```ts
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
```

## Configuration Notes

- **pino's own level is opened to `'trace'`** so the underlying logger sees every event. Per-transport gating is handled by each transport's own `level` option, so sibling transports configured at lower thresholds still receive the full event stream.
- Field layout is fixed: context goes under `context`, metadata under `metadata`; errors are serialized with `serialize-error`.

## Recommended App Pattern: keep the env mapping in the app

The package never reads env. Create a small adapter in your app that maps env to options and exports the same surface, so call sites stay stable:

```ts
// e.g. apps/studio/src/config/logger.ts
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

This is the pattern `apps/studio` uses. `src/index.ts` wires the logger into Hono:

```ts
import { honoLogLayer } from '@loglayer/hono'
import { createLogger } from './config/logger.js'

app.use(honoLogLayer({ instance: createLogger() }))
```

See `docs/libraries/LOG_LAYER.md` for the full `honoLogLayer` API (`c.var.logger`, auto request/response logging, `requestId`, grouping).

## Production

For production use set `pretty: false` for structured JSON output:

```ts
createLogger({ level: 'error', pretty: false })
```

## Tests

Use `createSilentLogger()` in tests so log calls don't write to stdout during the run:

```ts
import { createSilentLogger } from '@eduksource/logger'

const silent = createSilentLogger()
expect(() => silent.info('anything')).not.toThrow()
```
