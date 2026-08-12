import { PinoTransport } from '@loglayer/transport-pino'
import { LogLayer, type LogLayerConfig } from 'loglayer'
import { pino } from 'pino'
import pretty from 'pino-pretty'
import { serializeError } from 'serialize-error'
import { env } from './env.js'

const stream = pretty({
  colorize: true, // Enable colorization
  translateTime: 'SYS:HH:MM:ss', // Format timestamp
  ignore: 'pid,hostname', // Ignore these fields
})

const p = pino(
  {
    level: env.NODE_ENV === 'production' ? 'error' : 'debug',
  },
  stream
)

export const logConfig: LogLayerConfig = {
  errorSerializer: serializeError,

  transport: [
    new PinoTransport({
      enabled: true,
      logger: p,
    }),
  ],

  // Put context data in a specific field (default: flattened)
  contextFieldName: 'context',

  // Put metadata in a specific field (default: flattened)
  metadataFieldName: 'metadata',

  // Disable context/metadata in log output
  muteContext: false,
  muteMetadata: false,

  copyMsgOnOnlyError: true,
}

export const logger = new LogLayer(logConfig)

export function createLogger(): LogLayer {
  return new LogLayer(logConfig)
}
