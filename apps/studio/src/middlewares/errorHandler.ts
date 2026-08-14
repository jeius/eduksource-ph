import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { status as httpStatus } from 'http-status';
import { APIError } from 'openai/error';
import type { HonoSchema } from '../lib/types.js';

export const errorHandler: () => ErrorHandler<HonoSchema> = () => (err, c) => {
  if (err instanceof HTTPException) {
    c.var.logger.errorOnly(err);
    return err.getResponse();
  }

  if (err instanceof APIError) {
    c.var.logger.errorOnly(err);
    return c.json({ error: err.message, code: err.code }, err.status);
  }

  c.var.logger.withError(err).error('Request error');
  const unknownError = httpStatus.INTERNAL_SERVER_ERROR;
  return c.text(err.message || httpStatus[unknownError], unknownError);
};
