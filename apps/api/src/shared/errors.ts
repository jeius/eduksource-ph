import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { status as httpStatus } from 'http-status';

export class AppError extends HTTPException {
  constructor(
    public code: string,
    message: string,
    status: ContentfulStatusCode
  ) {
    super(status, { message });
    this.code = code;
  }

  static notFound(msg = 'Not found') {
    return new AppError('NOT_FOUND', msg, httpStatus.NOT_FOUND);
  }

  static conflict(msg = 'Conflict') {
    return new AppError('CONFLICT', msg, httpStatus.CONFLICT);
  }

  static unauthorized(msg = 'Unauthorized') {
    return new AppError('UNAUTHORIZED', msg, httpStatus.UNAUTHORIZED);
  }
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  return c.json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500);
}
