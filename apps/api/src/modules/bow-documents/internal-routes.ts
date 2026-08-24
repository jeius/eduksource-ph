import type { DrizzleDB } from '@eduksource/db';
import { BowCreateSchema, BowParamsSchema } from '@eduksource/schemas';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../config/env.js';
import { requireInternalToken } from '../../shared/middleware/auth.js';
import { createBow, getBow } from './service.js';

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
    path: '/internal/bow-documents',
    request: {
      body: { content: { 'application/json': { schema: BowCreateSchema } }, required: true },
    },
    responses: {
      201: {
        content: {
          'application/json': { schema: z.object({ contentHash: z.string() }) },
        },
        description: 'Created',
      },
      409: {
        content: {
          'application/json': {
            schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          },
        },
        description: 'Conflict',
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
    const body = c.req.valid('json');
    const row = await createBow(c.var.db, body);
    return c.json(row, 201);
  }
);

internalRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/internal/bow-documents/{contentHash}',
    request: { params: BowParamsSchema },
    responses: {
      200: {
        content: {
          'application/json': { schema: z.object({ contentHash: z.string() }).passthrough() },
        },
        description: 'Found',
      },
      404: {
        content: {
          'application/json': {
            schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          },
        },
        description: 'Not found',
      },
    },
  }),
  // @ts-expect-error — OpenAPI 404 response is thrown via AppError, not returned; handler satisfies 200 shape
  async (c) => {
    const { contentHash } = c.req.valid('param');
    const row = await getBow(c.var.db, contentHash);
    return c.json(row as unknown as { contentHash: string });
  }
);
