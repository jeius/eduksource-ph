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

// Deterministic env: tests must never depend on the developer's .env.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  NIM_API_KEY: 'test-nim-key',
  NIM_BASE_URL: 'https://nim.test/v1',
  NIM_MODEL_LESSON_PLAN: 'test-nim-lesson-plan',
  NIM_MODEL_OCR: 'test-nim-ocr',
  NIM_MODEL_IMAGE: 'test-nim-image',
  NIM_MODEL_EXTRACTION: 'test-nim-extraction',
};

const TEST_UNSET: string[] = [
  'AI_PROVIDER',
  'AI_MODEL_EXTRACTION',
  'AI_MODEL_OCR',
  'AI_MODEL_LESSON_PLAN',
  'AI_MODEL_SUMMATIVE_TEST',
  'AI_MODEL_IMAGE',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_MODEL_EXTRACTION',
  'OPENROUTER_MODEL_OCR',
  'OPENROUTER_MODEL_LESSON_PLAN',
  'OPENROUTER_MODEL_SUMMATIVE_TEST',
  'OPENROUTER_MODEL_IMAGE',
  'OPENCODE_API_KEY',
  'OPENCODE_BASE_URL',
  'OPENCODE_MODEL_EXTRACTION',
  'OPENCODE_MODEL_OCR',
  'OPENCODE_MODEL_LESSON_PLAN',
  'OPENCODE_MODEL_SUMMATIVE_TEST',
  'OPENCODE_MODEL_IMAGE',
  'NIM_CONTEXT_WINDOW',
  'OPENROUTER_CONTEXT_WINDOW',
  'OPENCODE_CONTEXT_WINDOW',
];

async function loadClient(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(TEST_ENV)) {
    vi.stubEnv(key, value);
  }
  for (const key of TEST_UNSET) {
    vi.stubEnv(key, undefined);
  }
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
      expect.objectContaining({ model: env.NIM_MODEL_EXTRACTION, stream: false })
    );
    expect(instances[0]!.baseURL).toBe(env.NIM_BASE_URL);
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
