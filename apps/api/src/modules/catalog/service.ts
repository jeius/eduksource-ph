import type { DrizzleDB } from '@eduksource/db';
import { products, productVersions } from '@eduksource/db/schema';
import type { CatalogCreateInput, CatalogFiltersSchema } from '@eduksource/schemas';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { AppError } from '../../shared/errors.js';

export type CatalogFilters = z.infer<typeof CatalogFiltersSchema>;

export async function listProducts(db: DrizzleDB, filters: CatalogFilters) {
  const conditions: SQL[] = [];
  if (filters.gradeLevel) conditions.push(eq(products.gradeLevel, filters.gradeLevel));
  if (filters.subject) conditions.push(eq(products.subject, filters.subject));
  if (filters.term) conditions.push(eq(products.term, filters.term));
  if (filters.status) conditions.push(eq(products.status, filters.status));

  const rows = await db
    .select()
    .from(products)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(products.id))
    .limit(filters.limit ?? 20);
  return rows;
}

export async function getProductById(db: DrizzleDB, id: number) {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw AppError.notFound('Product not found');
  return row;
}

export async function createProduct(db: DrizzleDB, input: CatalogCreateInput) {
  const [product] = await db
    .insert(products)
    .values({
      slug: input.slug,
      title: input.title,
      description: input.description,
      gradeLevel: input.gradeLevel,
      subject: input.subject,
      term: input.term,
      status: input.status ?? 'draft',
    })
    .returning();
  if (!product) throw AppError.conflict('Failed to create product');
  const [version] = await db
    .insert(productVersions)
    .values({
      productId: product.id,
      version: 1,
      source: 'studio_generated',
      r2Key: input.r2Key,
      versionNote: input.versionNote,
    })
    .returning();
  if (!version) throw AppError.conflict('Failed to create product version');
  return { product, version };
}
