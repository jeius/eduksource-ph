import type { DrizzleDB } from '@eduksource/db';
import type { CatalogCreateInput, CatalogFiltersSchema } from '@eduksource/schemas';
import type { z } from 'zod';
import { createProduct, getProductById, listProducts } from './service.js';

type CatalogFilters = z.infer<typeof CatalogFiltersSchema>;

/** RPC-shaped port for future cart/checkout modules. Single input object -> single return value. */
export async function getProductForCheckout(db: DrizzleDB, { productId }: { productId: number }) {
  return getProductById(db, productId);
}

export async function listProductsPort(db: DrizzleDB, filters: { filters: CatalogFilters }) {
  return listProducts(db, filters.filters);
}

export async function createProductPort(db: DrizzleDB, input: { input: CatalogCreateInput }) {
  return createProduct(db, input.input);
}
