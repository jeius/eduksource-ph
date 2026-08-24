import type { DrizzleDB } from '@eduksource/db';
import { CatalogFiltersSchema, CatalogIdParamsSchema } from '@eduksource/schemas';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../config/env.js';
import { requireSession } from '../../shared/middleware/auth.js';
import { getProductById, listProducts } from './service.js';

type Env = {
  Bindings: AppEnv;
  Variables: { db: DrizzleDB };
};

export const routes = new OpenAPIHono<Env>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 422);
    }
  },
});

const ProductSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  gradeLevel: z.string(),
  subject: z.string(),
  term: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

routes.openapi(
  createRoute({
    method: 'get',
    path: '/products',
    middleware: [requireSession] as const,
    request: { query: CatalogFiltersSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ products: z.array(ProductSchema) }) } },
        description: 'List products',
      },
    },
  }),
  async (c) => {
    const filters = c.req.valid('query');
    const rows = await listProducts(c.var.db, filters);
    return c.json({ products: rows }, 200);
  }
);

routes.openapi(
  createRoute({
    method: 'get',
    path: '/products/{id}',
    middleware: [requireSession] as const,
    request: { params: CatalogIdParamsSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: ProductSchema } },
        description: 'Product detail',
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
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getProductById(c.var.db, id);
    return c.json(row, 200);
  }
);
