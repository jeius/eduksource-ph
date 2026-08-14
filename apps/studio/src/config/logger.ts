import { PinoTransport } from '@loglayer/transport-pino'
import { LogLayer, type LogLayerConfig } from 'loglayer'
import { pino } from 'pino'
import pretty from 'pino-pretty'
import { serializeError } from 'serialize-error'
import { env } from './env.js'

const stream = pretty({
  colorize: true,
  translateTime: 'SYS:HH:MM:ss',
  ignore: 'pid,hostname',
})

// Pino's own level is opened up to 'trace' so the underlying logger sees every
// event. Per-transport gating (info vs error in production, etc.) is handled
// by each transport's own `level` option — e.g. PinoTransport below stays
// error-only when deployed standalone, while sibling transports (PostHog,
// Datadog) configured at lower thresholds still receive the full event stream.
const p = pino({ level: 'trace' }, stream)

const pinoTransportLevel = env.NODE_ENV === 'production' ? 'error' : 'debug'

export const logConfig: LogLayerConfig = {
  errorSerializer: serializeError,

  transport: [
    new PinoTransport({
      enabled: true,
      logger: p,
      level: pinoTransportLevel,
    }),
  ],

  contextFieldName: 'context',
  metadataFieldName: 'metadata',
  muteContext: false,
  muteMetadata: false,
  copyMsgOnOnlyError: true,
}

export const logger = new LogLayer(logConfig)

export function createLogger(): LogLayer {
  return new LogLayer(logConfig)
}

// A no-op logger used in tests so the logger middleware has a real
// LogLayer instance (so `c.var.logger` is defined and calls don't crash)
// without writing to pino/stdout during the test run.
export function createSilentLogger(): LogLayer {
  return new LogLayer({ transport: [] })
}
