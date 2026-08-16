import { honoLogLayer } from '@loglayer/hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { APIError } from 'openai/error';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../config/logger.js';
import type { HonoSchema } from '../lib/types.js';
import { errorHandler } from './errorHandler.js';

describe('errorHandler', () => {
  let app: Hono<HonoSchema>;
  let childLogger: {
    errorOnly: ReturnType<typeof vi.fn>;
    withError: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    withContext: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    const logger = createSilentLogger();
    // c.var.logger is `instance.child().withContext(...)` per request, so stub the child.
    childLogger = {
      errorOnly: vi.fn(),
      withError: vi.fn(),
      error: vi.fn(),
      withContext: vi.fn(),
    };
    childLogger.withError.mockReturnValue(childLogger);
    childLogger.withContext.mockReturnValue(childLogger);
    vi.spyOn(logger, 'child').mockReturnValue(
      childLogger as unknown as ReturnType<typeof logger.child>
    );

    app = new Hono();
    app.use(honoLogLayer({ instance: logger, autoLogging: false }));
    app.onError(errorHandler());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-emits HTTPException responses as-is', async () => {
    app.get('/http', () => {
      throw new HTTPException(404, { message: 'Not found' });
    });

    const res = await app.request('/http');

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    expect(childLogger.errorOnly).toHaveBeenCalledWith(expect.any(HTTPException));
  });

  it('returns a JSON error body for openai APIError', async () => {
    app.get('/openai', () => {
      throw new APIError(
        429,
        { code: 'rate_limited', message: 'slow down' },
        'slow down',
        undefined
      );
    });

    const res = await app.request('/openai');

    expect(res.status).toBe(429);
    // The openai SDK prefixes the status in the error message.
    expect(await res.json()).toEqual({ error: '429 slow down', code: 'rate_limited' });
    expect(childLogger.errorOnly).toHaveBeenCalledWith(expect.any(APIError));
  });

  it('returns 500 with the error message for unknown errors', async () => {
    app.get('/crash', () => {
      throw new Error('kaboom');
    });

    const res = await app.request('/crash');

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('kaboom');
    expect(childLogger.withError).toHaveBeenCalledWith(expect.any(Error));
    expect(childLogger.error).toHaveBeenCalledWith('Request error');
  });

  it('falls back to the default status text when the message is empty', async () => {
    app.get('/crash', () => {
      throw new Error();
    });

    const res = await app.request('/crash');

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');
  });
});
