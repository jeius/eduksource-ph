import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getConfiguredProviders,
  getPrimaryProvider,
  resolveModel,
  TASK_TYPES,
} from '../lib/ai/providers.js';
import { nimChat, nimChatStreamText } from '../lib/nim.js';

export function createHealthRoutes() {
  const health = new Hono();

  health.get('/', (c) => {
    return c.json({ status: 'ok' }, 200);
  });

  health.get('/nim', async (c) => {
    try {
      const reply = await nimChat([{ role: 'user', content: 'Reply with exactly: pong' }]);
      return c.json({ status: 'ok', reply }, 200);
    } catch (err) {
      return c.json({ status: 'failed', error: (err as Error).message }, 500);
    }
  });

  health.get('/nim/stream', async (c) => {
    return streamSSE(c, async (sseStream) => {
      try {
        for await (const chunk of nimChatStreamText(
          [{ role: 'user', content: 'Write me a dad joke for developers...' }]
        )) {
          await sseStream.writeSSE({ data: chunk });
        }
      } catch (err) {
        await sseStream.writeSSE({
          event: 'error',
          data: (err as Error).message,
        });
      }
    });
  });

  health.get('/providers', (c) => {
    const configured = getConfiguredProviders();
    const primary = getPrimaryProvider();
    const models: Record<string, Record<string, string | null>> = {};
    for (const provider of configured) {
      const providerModels: Record<string, string | null> = {};
      for (const task of TASK_TYPES) {
        try {
          providerModels[task] = resolveModel(provider, task);
        } catch {
          providerModels[task] = null;
        }
      }
      models[provider.name] = providerModels;
    }
    return c.json({
      primary: primary.name,
      configured: configured.map((p) => p.name),
      models,
    });
  });

  return health;
}
