import { describe, expect, it } from 'vitest';
import { createApiApp } from './app.js';

const env = {
  DATABASE_URI: process.env.DATABASE_URI ?? '',
  INTERNAL_SERVICE_TOKEN: 'test-token-32-chars-min-replace-me-xxx',
  LOG_LEVEL: 'info' as const,
};

describe('app', () => {
  it('GET /health returns 200 without DB', async () => {
    const app = createApiApp(env);
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('GET /openapi.json serves the OpenAPI document', async () => {
    const app = createApiApp(env);
    const res = await app.request('/openapi.json', {}, env);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('EdukSource API');
    expect(doc.info.version).toBe('1.0.0');
    // /health is a plain route, not an OpenAPI-registered one
    expect(Object.keys(doc.paths)).toContain('/products');
    expect(Object.keys(doc.paths)).toContain('/internal/products');
  });

  it('POST /internal/bow-documents returns 401 without X-Internal-Token', async () => {
    const app = createApiApp(env);
    const res = await app.request(
      '/internal/bow-documents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentHash: 'a'.repeat(64),
          schoolYear: '2026',
          extracted: {},
        }),
      },
      env
    );
    expect(res.status).toBe(401);
  });

  it('POST /internal/products returns 401 without X-Internal-Token', async () => {
    const app = createApiApp(env);
    const res = await app.request('/internal/products', { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });
});
