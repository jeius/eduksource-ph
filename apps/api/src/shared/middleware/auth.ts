import type { Context, Next } from 'hono';
import { AppError } from '../errors.js';

export function requireInternalToken(c: Context, next: Next) {
  const token = c.req.header('X-Internal-Token');
  if (!token || token !== c.env.INTERNAL_SERVICE_TOKEN) {
    throw AppError.unauthorized('Invalid internal token');
  }
  return next();
}

export function requireSession(c: Context, next: Next) {
  // stub: attach mock user for now; real BetterAuth later
  c.set('user', { id: 'stub', role: 'admin' });
  return next();
}
