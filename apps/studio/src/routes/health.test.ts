import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHealthRoutes } from './health.js';

const { mockedNimChat, mockedNimChatStreamText } = vi.hoisted(() => ({
  mockedNimChat: vi.fn(),
  mockedNimChatStreamText: vi.fn(),
}));

vi.mock('../lib/nim.js', () => ({
  nimChat: mockedNimChat,
  nimChatStreamText: mockedNimChatStreamText,
}));

const { mockedGetPrimaryProvider, mockedGetConfiguredProviders, mockedResolveModel } = vi.hoisted(
  () => ({
    mockedGetPrimaryProvider: vi.fn(),
    mockedGetConfiguredProviders: vi.fn(),
    mockedResolveModel: vi.fn(),
  })
);

vi.mock('../lib/ai/providers.js', () => ({
  getPrimaryProvider: mockedGetPrimaryProvider,
  getConfiguredProviders: mockedGetConfiguredProviders,
  resolveModel: mockedResolveModel,
  TASK_TYPES: ['extraction', 'ocr'],
}));

describe('createHealthRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 200 with status ok for `/`', async () => {
    const app = createHealthRoutes();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 200 with status ok for `/nim`', async () => {
    mockedNimChat.mockResolvedValue('pong');
    const app = createHealthRoutes();
    const res = await app.request('/nim');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toEqual('ok');
    expect(data.reply).toBe('pong');
    expect(mockedNimChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Reply with exactly: pong' }]
    );
  });

  it('returns 500 with status failed when NIM call throws', async () => {
    mockedNimChat.mockRejectedValue(new Error('NIM congestion'));
    const app = createHealthRoutes();
    const res = await app.request('/nim');
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.status).toEqual('failed');
    expect(data.error).toBe('NIM congestion');
  });

  it('returns SSE stream for `/nim/stream`', async () => {
    mockedNimChatStreamText.mockImplementation(async function* () {
      yield 'Why do programmers prefer dark mode?';
      yield 'Because light attracts bugs.';
    });
    const app = createHealthRoutes();
    const res = await app.request('/nim/stream');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const fullText = await res.text();
    expect(fullText).toContain('data:');
    expect(fullText).toContain('Why do programmers prefer dark mode?');
    expect(fullText).toContain('Because light attracts bugs.');
  });

  it('emits SSE error event when stream throws', async () => {
    mockedNimChatStreamText.mockImplementation(async function* () {
      yield '';
      throw new Error('stream failed');
    });
    const app = createHealthRoutes();
    const res = await app.request('/nim/stream');

    expect(res.status).toBe(200);
    const fullText = await res.text();
    expect(fullText).toContain('event: error');
    expect(fullText).toContain('stream failed');
  });
});

describe('GET /providers', () => {
  it('reports primary, configured providers, and per-task models', async () => {
    mockedGetPrimaryProvider.mockReturnValue({ name: 'nim' });
    mockedGetConfiguredProviders.mockReturnValue([{ name: 'nim' }, { name: 'openrouter' }]);
    mockedResolveModel.mockImplementation(
      (_provider: { name: string }, task: string) => `m-${task}`
    );
    const app = createHealthRoutes();

    const res = await app.request('/providers');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      primary: 'nim',
      configured: ['nim', 'openrouter'],
      models: {
        nim: { extraction: 'm-extraction', ocr: 'm-ocr' },
        openrouter: { extraction: 'm-extraction', ocr: 'm-ocr' },
      },
    });
  });

  it('reports null for providers that throw on a task', async () => {
    mockedGetPrimaryProvider.mockReturnValue({ name: 'nim' });
    mockedGetConfiguredProviders.mockReturnValue([{ name: 'nim' }, { name: 'openrouter' }]);
    mockedResolveModel.mockImplementation((provider: { name: string }, task: string) => {
      if (provider.name === 'openrouter' && task === 'ocr') throw new Error('No model configured');
      return `m-${task}`;
    });
    const app = createHealthRoutes();

    const res = await app.request('/providers');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      primary: 'nim',
      configured: ['nim', 'openrouter'],
      models: {
        nim: { extraction: 'm-extraction', ocr: 'm-ocr' },
        openrouter: { extraction: 'm-extraction', ocr: null },
      },
    });
  });

  it('reports empty models when no providers are configured', async () => {
    mockedGetPrimaryProvider.mockReturnValue({ name: 'nim' });
    mockedGetConfiguredProviders.mockReturnValue([]);
    const app = createHealthRoutes();

    const res = await app.request('/providers');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ primary: 'nim', configured: [], models: {} });
  });

  it('reports null for tasks a provider has no model for', async () => {
    mockedGetPrimaryProvider.mockReturnValue({ name: 'nim' });
    mockedGetConfiguredProviders.mockReturnValue([{ name: 'nim' }]);
    mockedResolveModel.mockImplementation(() => {
      throw new Error('No model configured');
    });
    const app = createHealthRoutes();

    const res = await app.request('/providers');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      primary: 'nim',
      configured: ['nim'],
      models: { nim: { extraction: null, ocr: null } },
    });
  });
});
