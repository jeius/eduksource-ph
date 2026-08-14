# **Title:** Hono Integration

**Source:** [https://loglayer.dev/integrations/hono.html](https://loglayer.dev/integrations/hono.html)

A Hono middleware that provides request-scoped logging with automatic request/response logging and error handling. The auto-logging format follows pino-http conventions.

## Installation ​

npm

```bash
npm i @loglayer/hono loglayer @loglayer/transport-simple-pretty-terminal serialize-error
```

pnpm

```bash
pnpm add @loglayer/hono loglayer @loglayer/transport-simple-pretty-terminal serialize-error
```

yarn

```bash
yarn add @loglayer/hono loglayer @loglayer/transport-simple-pretty-terminal serialize-error
```

We're using Simple Pretty Terminal here as an example to get nicely formatted logs. Any LogLayer-compatible transport can be used, including Pino, LogTape, Structured, Console, and others.

## Basic Usage ​

typescript

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { LogLayer } from "loglayer";
import { serializeError } from "serialize-error";
import { getSimplePrettyTerminal, moonlight } from "@loglayer/transport-simple-pretty-terminal";
import { honoLogLayer, type HonoLogLayerVariables } from "@loglayer/hono";

const log = new LogLayer({
  errorSerializer: serializeError,
  transport: getSimplePrettyTerminal({
    runtime: "node",
    theme: moonlight,
  }),
});

const app = new Hono<{ Variables: HonoLogLayerVariables }>();
app.use(honoLogLayer({ instance: log }));

app.get("/", (c) => {
  c.var.logger.info("Hello from route!");
  return c.text("Hello World!");
});

app.get("/api/users/:id", (c) => {
  const id = c.req.param("id");
  c.var.logger.withMetadata({ userId: id }).info("Fetching user");
  return c.json({ id, name: "John" });
});

serve({ fetch: app.fetch, port: 3000 });
```

Each request automatically gets:

- A child logger with a unique `requestId` in its context
- Automatic request and response logging following pino-http conventions

The middleware sets a LogLayer child logger on `c.var.logger`, so you can use it directly in your route handlers with full access to LogLayer's API.

TypeScript Support

The package exports a `HonoLogLayerVariables` type. Pass it as a generic to `new Hono<{ Variables: HonoLogLayerVariables }>()` for full type safety with `c.var.logger`. This composes with your own variables:

typescript

```ts
type AppEnv = { Variables: HonoLogLayerVariables & { user: User } };
const app = new Hono<AppEnv>();
```

## Configuration Options ​

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `instance` | `ILogLayer` | _required_ | The LogLayer instance to use |
| `requestId` | `boolean | (request: Request) => string` | `true` | Controls request ID generation |
| `autoLogging` | `boolean | HonoAutoLoggingConfig` | `true` | Controls automatic request/response logging |
| `contextFn` | `(context: { request: Request, path: string }) => Record<string, any>` | \- | Extract additional context from requests |
| `group` | `boolean | HonoGroupConfig` | \- | Tag auto-logged messages with groups for transport routing |

### Auto-Logging Configuration ​

When `autoLogging` is an object:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `logLevel` | `string` | `"info"` | Default log level for request/response logs |
| `ignore` | `Array<string | RegExp>` | `[]` | Paths to exclude from auto-logging |
| `request` | `boolean | HonoRequestLoggingConfig` | `true` | Controls request logging (fires when request is received) |
| `response` | `boolean | HonoResponseLoggingConfig` | `true` | Controls response logging (fires after response is sent) |

Both `request` and `response` accept an object with a `logLevel` property to override the default log level.

### Request Log Output ​

When enabled (default), request logging produces:

- **Message**: `"incoming request"`
- **Metadata**: `{ req: { method, url, remoteAddress } }`

### Response Log Output ​

When enabled (default), response logging produces:

- **Message**: `"request completed"`
- **Metadata**: `{ req: { method, url, remoteAddress }, res: { statusCode }, responseTime }`

The `remoteAddress` is resolved from `x-forwarded-for` or `x-real-ip` headers.

### Example Log Output ​

With the default configuration using Structured Transport, a `GET /api/users` request produces two log entries:

json

```console
// incoming request
{
  "level": "info",
  "time": "2026-02-12T10:30:45.123Z",
  "msg": "incoming request",
  "req": { "method": "GET", "url": "/api/users", "remoteAddress": "127.0.0.1" },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}

// request completed
{
  "level": "info",
  "time": "2026-02-12T10:30:45.135Z",
  "msg": "request completed",
  "req": { "method": "GET", "url": "/api/users", "remoteAddress": "127.0.0.1" },
  "res": { "statusCode": 200 },
  "responseTime": 12,
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Examples ​

### Custom Log Levels ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  autoLogging: {
    request: { logLevel: "debug" },
    response: { logLevel: "info" },
  },
}));
```

### Disable Request Logging (Response Only) ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  autoLogging: {
    request: false,
  },
}));
```

### Custom Request ID ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  requestId: (request) =>
    request.headers.get("x-request-id") ?? crypto.randomUUID(),
}));
```

### Disable Auto-Logging ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  autoLogging: false,
}));
```

### Ignore Health Check Paths ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  autoLogging: {
    ignore: ["/health", "/ready", /^\/internal\//],
  },
}));
```

### Additional Context from Request ​

typescript

```ts
app.use(honoLogLayer({
  instance: log,
  contextFn: ({ request }) => ({
    userAgent: request.headers.get("user-agent"),
    host: request.headers.get("host"),
  }),
}));
```

### Error Handling ​

Use Hono's `app.onError` handler to log errors with the request-scoped logger:

typescript

```ts
app.onError((err, c) => {
  c.var.logger.withError(err).error("Request error");
  return c.text("Internal Server Error", 500);
});

app.get("/fail", () => {
  throw new Error("Something went wrong");
  // Automatically logged via app.onError
});
```

TIP

Hono's error handler runs after the middleware chain, so `c.var.logger` is available with the full request context (requestId, custom context, etc.).

### Group Routing ​

Tag auto-logged messages (request, response) with groups so you can route or filter them. User logs from route handlers are **not** tagged.

typescript

```ts
const log = new LogLayer({
  transport: [
    new ConsoleTransport({ id: 'console', logger: console }),
    new DatadogTransport({ id: 'datadog', logger: datadog }),
  ],
  groups: {
    hono: { transports: ['datadog'] },
    'hono.request': { transports: ['datadog'] },
    'hono.response': { transports: ['console', 'datadog'] },
  },
})

// Use default group names: request="hono.request", response="hono.response"
app.use(honoLogLayer({ instance: log, group: true }))

// Or use custom group names
app.use(honoLogLayer({
  instance: log,
  group: {
    request: 'api.request',  // auto-logged requests
    response: 'api.response', // auto-logged responses
  },
}))
```

When `group` is `true` or an object:

| Group | Default | Applied to |
| --- | --- | --- |
| `request` | `"hono.request"` | Auto-logged incoming request messages |
| `response` | `"hono.response"` | Auto-logged response messages |

### Using with Other Hono Middleware ​

typescript

```ts
import { cors } from "hono/cors";

const app = new Hono();
app.use(honoLogLayer({ instance: log }));
app.use(cors());

app.get("/", (c) => {
  c.var.logger.info("Works with other middleware!");
  return c.text("ok");
});
```

## **Title:** Basic Logging

**Source:** [https://loglayer.dev/logging-api/basic-logging.html](https://loglayer.dev/logging-api/basic-logging.html)

## Basic Logging ​

LogLayer provides a simple and consistent API for logging messages at different severity levels. This guide covers the basics of logging messages.

## Basic Message Logging ​

The simplest way to log a message is to use one of the log level methods:

typescript

```bash
// Basic info message
log.info('User logged in successfully')

// Warning message
log.warn('API rate limit approaching')

// Error message
log.error('Failed to connect to database')

// Debug message
log.debug('Processing request payload')

// Trace message (detailed debugging)
log.trace('Entering authentication function')

// Fatal message (critical errors)
log.fatal('System out of memory')
```

## Message Parameters ​

All log methods accept multiple parameters, which can be strings, booleans, numbers, null, or undefined:

typescript

```ts
// Multiple parameters
log.info('User', 123, 'logged in')

// With string formatting
log.info('User %s logged in from %s', 'john', 'localhost')
```

sprintf-style formatting

The logging library you use may or may not support sprintf-style string formatting. If it does not, you can use the sprintf plugin to enable support.

## Tagged Template Syntax ​

All log methods support native JavaScript tagged template syntax. This allows you to write natural template strings without parentheses:

typescript

```ts
const userId = '123'
const action = 'login'

// Basic tagged template
log.info`User ${userId} logged in`

// Multiple interpolations
log.info`User ${userId} performed ${action}`

// Works with all log levels
log.warn`Request ${requestId} timed out`
log.error`Failed: ${error.message}`
log.debug`Cache hit for ${cacheKey}`
```

### With Fluent API ​

Tagged templates work seamlessly with LogLayer's fluent API:

typescript

```ts
// With context
log.withContext({ userId, requestId })
  .info`User ${userId} requested ${requestId}`

// With metadata
log.withMetadata({ duration: 150, status: 200 })
  .info`Request completed in ${duration}ms with status ${status}`

// With error
log.withError(error)
  .error`Operation failed: ${error.message}`

// Full chain
log
  .withContext({ userId, requestId })
  .withMetadata({ duration: 150 })
  .withError(error)
  .warn`Request ${requestId} timed out after ${duration}ms`
```

### Behavior ​

- **Immediate value capture**: Values are captured when the template is evaluated (standard tagged template behavior)
- **String coercion**: All interpolated values use `String()` for coercion
- **Object handling**: Objects are stringified to `"[object Object]"` — this is intentional. Use `withMetadata()` or `withContext()` for structured data

typescript

```ts
// null becomes "null"
log.info`User ${null} logged in`  // "User null logged in"

// undefined becomes "undefined"
log.info`Value: ${undefined}`     // "Value: undefined"

// Pure interpolations work too
log.info`${userId}`               // "123"

// For structured objects, use metadata (not template interpolations)
log.withMetadata({ user }).info`User logged in`
```

## Message Prefixing ​

You can add a prefix to all log messages either through configuration or using the `withPrefix` method:

typescript

```ts
// Via configuration
const log = new LogLayer({
  prefix: '[MyApp]',
  transport: new ConsoleTransport({
    logger: console
  })
})

// Via method
const prefixedLogger = log.withPrefix('[MyApp]')

// Output: "[MyApp] User logged in"
prefixedLogger.info('User logged in')
```

## Raw Logging ​

The `raw(logEntry: RawLogEntry)` method allows you to bypass the normal LogLayer API and directly specify all aspects of a log entry. This is useful for scenarios where you need to log structured data that doesn't fit the standard LogLayer patterns, or when integrating with external logging systems that provide pre-formatted log entries.

The raw entry will still go through all LogLayer processing like the log level methods.

typescript

```ts
import { LogLevel } from 'loglayer'

// Basic raw logging with just a message
log.raw({
  logLevel: LogLevel.info,
  messages: ['User action completed', { userId: 123 }]
})
```

### Raw Logging Parameters ​

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `logLevel` | `LogLevelType` | Yes | The log level for this entry |
| `messages` | `MessageDataType[]` | No | Array of message parameters |
| `metadata` | `Record<string, any>` | No | Additional metadata to include |
| `rootData` | `Record<string, any>` | No | Data spread directly at root level, bypassing `metadataFieldName` / `contextFieldName` nesting |
| `error` | `any` | No | Error object to include |
| `context` | `Record<string, any>` | No | Context data to include (see notes below) |

### Context Behavior ​

When using the `context` parameter in raw logging, the behavior depends on whether you provide the `context` parameter or not.

- If you provide a `context` in the raw entry, that context data will be used instead of the context manager for that specific log entry.
- If you do not provide a `context`, the context manager data will be used (like normal logging).
- Passing an empty object `{}` as `context` will result in no context data being included for that log entry.

### Examples ​

typescript

```ts
import { LogLayer, ConsoleTransport, LogLevel } from 'loglayer'

const log = new LogLayer({
  transport: new ConsoleTransport({
    logger: console,
    messageField: 'msg'
  }),
  // Configure custom field names for better organization
  contextFieldName: 'ctx',
  metadataFieldName: 'meta',
  errorFieldName: 'err'
})

// Set some stored context
log.withContext({ userId: 123, sessionId: 'abc' })

// This will use the stored context
log.raw({
  logLevel: LogLevel.info,
  messages: ['User action']
})
// Output: { "level": "info", "msg": "User action", "ctx": { "userId": 123, "sessionId": "abc" } }

// This will override the stored context for this entry only
log.raw({
  logLevel: LogLevel.info,
  messages: ['Admin action'],
  context: { adminId: 456, action: 'override' }
})
// Output: { "level": "info", "msg": "Admin action", "ctx": { "adminId": 456, "action": "override" } }

// This will use the stored context again (userId: 123, sessionId: 'abc')
log.raw({
  logLevel: LogLevel.info,
  messages: ['Another user action']
})
// Output: { "level": "info", "msg": "Another user action", "ctx": { "userId": 123, "sessionId": "abc" } }

// This will override with empty context, resulting in no context data
log.raw({
  logLevel: LogLevel.info,
  messages: ['System action'],
  context: {} // Empty context overrides stored context
})
// Output: { "level": "info", "msg": "System action" }

// Example with metadata and error
log.raw({
  logLevel: LogLevel.error,
  messages: ['Database operation failed'],
  metadata: { operation: 'insert', table: 'users' },
  error: new Error('Connection timeout'),
  context: { requestId: 'req-789' }
})
// Output: { "level": "error", "msg": "Database operation failed", "ctx": { "requestId": "req-789" }, "meta": { "operation": "insert", "table": "users" }, "err": { "type": "Error", "message": "Connection timeout", "stack": "Error: Connection timeout\n    at ..." } }
```

### Root Data (Flat Emission)

The `rootData` parameter spreads data directly at the root level of the log entry, bypassing `metadataFieldName` / `contextFieldName` nesting. This is useful when you need guaranteed flat structures regardless of LogLayer configuration.

```typescript
// rootData always stays flat at root, even with metadataFieldName configured
log.raw({
  logLevel: LogLevel.info,
  messages: ['Flat emission'],
  metadata: { nested: 'under-meta' },
  rootData: { userId: '123', action: 'login' }
})
// With metadataFieldName: 'meta':
// Output: { "level": "info", "msg": "Flat emission", "meta": { "nested": "under-meta" }, "userId": "123", "action": "login" }

// rootData can override same-named fields from metadata
log.raw({
  logLevel: LogLevel.info,
  messages: ['Override test'],
  metadata: { status: 'from-metadata' },
  rootData: { status: 'from-rootdata' }
})
// Output: { "level": "info", "msg": "Override test", "status": "from-rootdata" }
```

- rootData can override core fields

- `rootData` is spread **before** `onBeforeDataOut` plugin hooks run, so plugins can see and redact its fields. `@loglayer/plugin-redaction` will redact `rootData` fields.

- However, `rootData` can override core fields like `level`, `msg`, or the error field name (`err`). Be careful not to use keys that conflict with LogLayer's own output fields.

Note: Unlike `metadata`, `rootData` does not support lazy evaluation.
