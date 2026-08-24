import { createDb } from '@eduksource/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { parseEnv } from './config/env.js';
import { internalRoutes as bowInternalRoutes } from './modules/bow-documents/index.js';
import {
  internalRoutes as catalogInternalRoutes,
  routes as catalogRoutes,
} from './modules/catalog/index.js';
import { errorHandler } from './shared/errors.js';

export function createApiApp(rawEnv: Record<string, unknown>) {
  const env = parseEnv(rawEnv);
  const app = new OpenAPIHono<{
    Bindings: typeof env;
    Variables: { db: ReturnType<typeof createDb> };
  }>();
  app.use('*', async (c, next) => {
    c.set('db', createDb(c.env.DATABASE_URI));
    await next();
  });
  // Register top-level routes before module mounts: modules are mounted at '/'
  // with their own catch-all auth middleware, which would otherwise intercept
  // these paths first.
  app.get('/health', (c) => c.json({ ok: true }));
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'EdukSource API', version: '1.0.0' },
  });
  app.route('/', catalogRoutes);
  app.route('/', catalogInternalRoutes);
  app.route('/', bowInternalRoutes);
  app.onError(errorHandler);
  return app;
}
