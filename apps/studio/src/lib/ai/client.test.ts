import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, instances } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const instances: { apiKey?: string; baseURL?: string }[] = [];
  return { mockCreate, instances };
});

vi.mock('openai', () => {
  class MockOpenAI {
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      instances.push(opts);
    }
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }
  return { default: MockOpenAI };
});

const completion = {
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
};

async function loadClient(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv('AI_PROVIDER', undefined);
  vi.stubEnv('OPENROUTER_API_KEY', undefined);
  vi.stubEnv('OPENCODE_API_KEY', undefined);
  vi.stubEnv('OPENCODE_BASE_URL', undefined);
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  const client = await import('./client.js');
  const envModule = await import('../../config/env.js');
  return { client, env: envModule.env };
}

afterEach(() => {
  vi.unstubAllEnvs();
  mockCreate.mockReset();
  instances.length = 0;
});

describe('chatDetailed', () => {
  it('calls the primary provider once and maps the result', async () => {
    mockCreate.mockResolvedValue(completion);
    const { client, env } = await loadClient({});

    const result = await client.chatDetailed([{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: env.NIM_MODEL_REASONING, stream: false })
    );
    expect(instances[0]!.baseURL).toBe(env.NVIDIA_NIM_BASE_URL);
    expect(result).toEqual({
      content: '{"ok":true}',
      usage: { input: 120, output: 45 },
      finishReason: 'stop',
    });
  });

  it('falls back to the next provider when the primary throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('NIM congestion')).mockResolvedValueOnce(completion);
    const { client } = await loadClient({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'or-model',
    });

    const result = await client.chatDetailed([{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'or-model' }));
    expect(instances[1]!.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(result.content).toBe('{"ok":true}');
  });

  it('rejects with the last error when every provider fails', async () => {
    mockCreate.mockRejectedValue(new Error('opencode unreachable'));
    const { client } = await loadClient({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'or-model',
      OPENCODE_API_KEY: 'sk-oc-test',
      OPENCODE_BASE_URL: 'http://localhost:9999/v1',
      OPENCODE_MODEL_EXTRACTION: 'oc-extract-model',
    });

    await expect(client.chatDetailed([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'opencode unreachable'
    );
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('skips fallback providers that have no model for the task', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('NIM congestion'))
      .mockRejectedValueOnce(new Error('openrouter down'));
    const { client } = await loadClient({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'or-model',
      OPENCODE_API_KEY: 'sk-oc-test',
      OPENCODE_BASE_URL: 'http://localhost:9999/v1',
    });

    await expect(client.chatDetailed([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'openrouter down'
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit model for the primary provider', async () => {
    mockCreate.mockResolvedValue(completion);
    const { client } = await loadClient({});

    await client.chatDetailed([{ role: 'user', content: 'hi' }], { model: 'custom-model' });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-model' }));
  });

  it('passes the openrouter model list via extra_body when 2+ models are configured', async () => {
    mockCreate.mockResolvedValue(completion);
    const { client } = await loadClient({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'first-model,model-b,model-c',
    });

    await client.chatDetailed([{ role: 'user', content: 'hi' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'first-model' }),
      expect.objectContaining({
        extra_body: { models: ['first-model', 'model-b', 'model-c'] },
      })
    );
  });
});

describe('visionChat', () => {
  it('uses the ocr model and sends base64 images', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Extracted text' }, finish_reason: 'stop' }],
    });
    const { client, env } = await loadClient({});

    const result = await client.visionChat(['img1'], 'Extract text');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.NIM_MODEL_OCR,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract text' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
            ],
          },
        ],
      })
    );
    expect(result).toBe('Extracted text');
  });
});

describe('chatStreamText', () => {
  it('parses SSE chunks and flushes a final [DONE] line without trailing newline', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hello "}}]}\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n',
      'data: [DONE]',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    mockCreate.mockResolvedValue({
      tee: () => [
        { toReadableStream: () => new ReadableStream() },
        { toReadableStream: () => stream },
      ],
    });
    const { client } = await loadClient({});

    const parts: string[] = [];
    for await (const chunk of client.chatStreamText([{ role: 'user', content: 'hi' }])) {
      parts.push(chunk);
    }

    expect(parts).toEqual(['hello ', 'world']);
  });
});
