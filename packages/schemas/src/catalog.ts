import { z } from 'zod';

export const CatalogCreateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  gradeLevel: z.string().min(1).max(50),
  subject: z.string().min(1).max(100),
  term: z.string().min(1).max(100),
  r2Key: z.string().min(1).max(500),
  versionNote: z.string().max(2000).optional(),
  status: z.enum(['draft', 'published']).default('draft').optional(),
});

export const CatalogFiltersSchema = z.object({
  gradeLevel: z.string().optional(),
  subject: z.string().optional(),
  term: z.string().optional(),
  strand: z.string().optional(),
  topic: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().optional(),
});

export const CatalogIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export type CatalogCreateInput = z.infer<typeof CatalogCreateSchema>;
