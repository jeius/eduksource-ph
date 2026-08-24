import type { DrizzleDB } from '@eduksource/db';
import { CatalogCreateSchema } from '@eduksource/schemas';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../config/env.js';
import { requireInternalToken } from '../../shared/middleware/auth.js';
import { createProduct } from './service.js';

type Env = {
  Bindings: AppEnv;
  Variables: { db: DrizzleDB };
};

export const internalRoutes = new OpenAPIHono<Env>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 422);
    }
  },
});

internalRoutes.use('*', requireInternalToken);

internalRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/internal/products',
    request: {
      body: { content: { 'application/json': { schema: CatalogCreateSchema } }, required: true },
    },
    responses: {
      201: {
        content: {
          'application/json': {
            schema: z.object({ product: z.unknown(), version: z.unknown() }),
          },
        },
        description: 'Product created',
      },
      422: {
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), error: z.unknown() }) },
        },
        description: 'Validation error',
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const result = await createProduct(c.var.db, input);
    return c.json(result, 201);
  }
);
