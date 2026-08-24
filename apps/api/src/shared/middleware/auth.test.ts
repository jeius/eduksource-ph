import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireInternalToken } from './auth.js';

describe('requireInternalToken', () => {
  it('401 when missing', async () => {
    const app = new Hono();
    app.get('/x', requireInternalToken, (c) => c.text('ok'));
    const res = await app.request(
      '/x',
      {},
      { INTERNAL_SERVICE_TOKEN: 'valid-token-32-chars-min-replace-me' }
    );
    expect(res.status).toBe(401);
  });

  it('401 when wrong token', async () => {
    const app = new Hono();
    app.get('/x', requireInternalToken, (c) => c.text('ok'));
    const res = await app.request(
      '/x',
      { headers: { 'X-Internal-Token': 'wrong' } },
      { INTERNAL_SERVICE_TOKEN: 'valid-token-32-chars-min-replace-me' }
    );
    expect(res.status).toBe(401);
  });
});
