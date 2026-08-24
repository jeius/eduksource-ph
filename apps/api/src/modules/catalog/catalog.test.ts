import { beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../app.js';

const env = {
  DATABASE_URI: process.env.DATABASE_URI ?? '',
  INTERNAL_SERVICE_TOKEN: 'test-token-32-chars-min-replace-me-xxx',
  LOG_LEVEL: 'info' as const,
};

describe('catalog', () => {
  let app: ReturnType<typeof createApiApp>;

  beforeAll(() => {
    if (!env.DATABASE_URI) {
      throw new Error('DATABASE_URI is required for catalog tests (real Supabase)');
    }
    app = createApiApp(env);
  });

  it('GET /products returns 200 with products array', async () => {
    const res = await app.request('/products', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: unknown[] };
    expect(Array.isArray(body.products)).toBe(true);
  });

  it('GET /products validates query params -> 422 on bad limit', async () => {
    const res = await app.request('/products?limit=nope', {}, env);
    expect(res.status).toBe(422);
  });

  it('GET /products/999999999 returns 404 for missing product', async () => {
    const res = await app.request('/products/999999999', {}, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('POST /internal/products returns 401 without token', async () => {
    const res = await app.request(
      '/internal/products',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'test-product',
          title: 't',
          gradeLevel: '7',
          subject: 'Math',
          term: 'Q1',
          r2Key: 'k',
        }),
      },
      env
    );
    expect(res.status).toBe(401);
  });

  it('POST /internal/products returns 422 on bad body', async () => {
    const res = await app.request(
      '/internal/products',
      {
        method: 'POST',
        headers: {
          'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug: '' }),
      },
      env
    );
    expect(res.status).toBe(422);
  });

  it('POST /internal/products creates a product and version (201)', async () => {
    const slug = `test-catalog-${Date.now()}`;
    const res = await app.request(
      '/internal/products',
      {
        method: 'POST',
        headers: {
          'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug,
          title: 'Test Product',
          gradeLevel: '7',
          subject: 'Math',
          term: 'Q1',
          r2Key: 'test/r2-key.pdf',
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      product: { id: number; slug: string };
      version: { version: number };
    };
    expect(body.product.slug).toBe(slug);
    expect(body.version.version).toBe(1);

    // GET by id round-trips
    const getRes = await app.request(`/products/${body.product.id}`, {}, env);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { slug: string };
    expect(got.slug).toBe(slug);
  });
});
