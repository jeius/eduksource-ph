import { describe, expect, it } from 'vitest';
import { createLogger, createSilentLogger } from './logger.js';

describe('logger', () => {
  const log = createLogger();

  it('exports logger instance', () => {
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('logs info level without throwing', () => {
    expect(() => log.info('test info message')).not.toThrow();
  });

  it('logs warn level without throwing', () => {
    expect(() => log.warn('test warn message')).not.toThrow();
  });

  it('logs error level with error serialization without throwing', () => {
    const error = new Error('test error');
    expect(() =>
      log.withPrefix('[SYSTEM]').withError(error).error('test error message')
    ).not.toThrow();
  });

  it('logs debug level without throwing', () => {
    expect(() => log.debug('test debug message')).not.toThrow();
  });

  it('supports child loggers with context', () => {
    const childLog = log.child();
    expect(childLog).toBeDefined();
    expect(() => childLog.info('child logger message')).not.toThrow();
  });

  it('supports withContext', () => {
    const contextLog = createLogger().withContext({ requestId: '123' });
    expect(contextLog).toBeDefined();
    expect(() => contextLog.info('context message')).not.toThrow();
  });

  it('supports withMetadata', () => {
    const metaLog = createLogger().withMetadata({ username: 'Jeius' });
    expect(metaLog).toBeDefined();
    expect(() => metaLog.info('metadata message')).not.toThrow();
  });

  it('createSilentLogger produces a logger with no transport', () => {
    const silent = createSilentLogger();
    expect(silent).toBeDefined();
    expect(() => silent.info('silent message')).not.toThrow();
    expect(() => silent.error('silent error')).not.toThrow();
  });

  it('createLogger accepts a custom level', () => {
    const errorLog = createLogger({ level: 'error' });
    expect(errorLog).toBeDefined();
    expect(() => errorLog.error('error only message')).not.toThrow();
  });
});
