import { createDb } from '@eduksource/db';
import { Hono } from 'hono';
import { parseEnv } from './config/env.js';
import { errorHandler } from './shared/errors.js';

export function createApiApp(rawEnv: Record<string, unknown>) {
  const env = parseEnv(rawEnv);
  const app = new Hono<{
    Bindings: typeof env;
    Variables: { db: ReturnType<typeof createDb> };
  }>();
  app.use('*', async (c, next) => {
    c.set('db', createDb(c.env.DATABASE_URI));
    await next();
  });
  app.get('/health', (c) => c.json({ ok: true }));
  // catalog + bow-documents mounted in Tasks 4/5
  app.onError(errorHandler);
  return app;
}
