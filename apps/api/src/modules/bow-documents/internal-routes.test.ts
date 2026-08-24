import { beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../app.js';

const env = {
  DATABASE_URI: process.env.DATABASE_URI ?? '',
  INTERNAL_SERVICE_TOKEN: 'test-token-32-chars-min-replace-me-xxx',
  LOG_LEVEL: 'info' as const,
};

describe('bow-documents', () => {
  let app: ReturnType<typeof createApiApp>;

  beforeAll(() => {
    if (!env.DATABASE_URI) {
      throw new Error('DATABASE_URI is required for bow-documents tests (real Supabase)');
    }
    app = createApiApp(env);
  });

  it('POST /internal/bow-documents returns 401 without token', async () => {
    const res = await app.request(
      '/internal/bow-documents',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /internal/bow-documents returns 422 on invalid contentHash', async () => {
    const payload = {
      contentHash: 'not-hex',
      gradeLevel: '7',
      learningArea: 'Math',
      schoolYear: '2024-2025',
      r2JsonKey: 'json/k',
      r2PdfKey: 'pdf/k',
      extractionProvider: 'openrouter',
      extractionModel: 'x',
    };
    const res = await app.request(
      '/internal/bow-documents',
      {
        method: 'POST',
        headers: {
          'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      env
    );
    expect(res.status).toBe(422);
  });

  it('GET /internal/bow-documents/{hash} returns 404 for unknown hash', async () => {
    const hash = 'f'.repeat(64);
    const res = await app.request(
      `/internal/bow-documents/${hash}`,
      { headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN } },
      env
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('POST then GET round-trip, second POST 409', async () => {
    // unique per-run hash so repeated test runs don't collide with prior rows
    const rand = crypto.randomUUID().replaceAll('-', '');
    const contentHash = `${'a'.repeat(56)}${rand.slice(0, 8)}`;
    const payload = {
      contentHash,
      gradeLevel: '7',
      learningArea: 'Math',
      schoolYear: '2024-2025',
      r2JsonKey: `json/${contentHash}.json`,
      r2PdfKey: `pdf/${contentHash}.pdf`,
      extractionProvider: 'openrouter',
      extractionModel: 'x',
    };
    const headers = {
      'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN,
      'Content-Type': 'application/json',
    };

    const created = await app.request(
      '/internal/bow-documents',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      env
    );
    expect(created.status).toBe(201);
    const row = (await created.json()) as { contentHash: string; schoolYear: string };
    expect(row.contentHash).toBe(contentHash.toLowerCase());
    expect(row.schoolYear).toBe('2024-2025');

    const duplicate = await app.request(
      '/internal/bow-documents',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      env
    );
    expect(duplicate.status).toBe(409);
    const dupBody = (await duplicate.json()) as { error: { code: string } };
    expect(dupBody.error.code).toBe('CONFLICT');

    const fetched = await app.request(
      `/internal/bow-documents/${payload.contentHash.toUpperCase()}`,
      { headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN } },
      env
    );
    expect(fetched.status).toBe(200);
    const got = (await fetched.json()) as { contentHash: string };
    expect(got.contentHash).toBe(contentHash.toLowerCase());
  });
});
