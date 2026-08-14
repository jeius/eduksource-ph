import { PinoTransport } from '@loglayer/transport-pino';
import { LogLayer, type LogLayerConfig } from 'loglayer';
import { pino } from 'pino';
import pretty from 'pino-pretty';
import { serializeError } from 'serialize-error';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
  enabled?: boolean;
}

const DEFAULT_LEVEL: LogLevel = 'debug';

function buildConfig(options: Required<LoggerOptions>): LogLayerConfig {
  const base = {
    errorSerializer: serializeError,
    contextFieldName: 'context',
    metadataFieldName: 'metadata',
    muteContext: false,
    muteMetadata: false,
    copyMsgOnOnlyError: true,
  };

  if (!options.enabled) {
    return { ...base, transport: [] };
  }

  const stream = options.pretty
    ? pretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      })
    : undefined;

  // Pino's own level is opened to 'trace' so the underlying logger sees every
  // event. Per-transport gating (info vs error in production) is handled by
  // each transport's own `level` option, so sibling transports configured at
  // lower thresholds still receive the full event stream.
  const p = pino({ level: 'trace' }, stream);

  return {
    ...base,
    transport: [
      new PinoTransport({
        enabled: true,
        logger: p,
        level: options.level,
      }),
    ],
  };
}

export function createLogger(options: LoggerOptions = {}): LogLayer {
  const resolved: Required<LoggerOptions> = {
    level: options.level ?? DEFAULT_LEVEL,
    pretty: options.pretty ?? true,
    enabled: options.enabled ?? true,
  };
  return new LogLayer(buildConfig(resolved));
}

export function createSilentLogger(): LogLayer {
  return createLogger({ enabled: false });
}
