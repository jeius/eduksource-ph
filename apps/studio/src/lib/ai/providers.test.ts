import { afterEach, describe, expect, it, vi } from 'vitest';

// Deterministic env: tests must never depend on the developer's .env.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  NVIDIA_API_KEY: 'test-nim-key',
  NVIDIA_NIM_BASE_URL: 'https://nim.test/v1',
  NIM_MODEL_REASONING: 'test-nim-reasoning',
  NIM_MODEL_OCR: 'test-nim-ocr',
  NIM_MODEL_IMAGE: 'test-nim-image',
};

const TEST_UNSET: string[] = [
  'AI_PROVIDER',
  'AI_MODEL_EXTRACTION',
  'AI_MODEL_OCR',
  'AI_MODEL_LESSON_PLAN',
  'AI_MODEL_SUMMATIVE_TEST',
  'AI_MODEL_IMAGE',
  'OPENROUTER_API_KEY',
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
];

async function loadProviders(overrides: Record<string, string | undefined>) {
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
  const providers = await import('./providers.js');
  const envModule = await import('../../config/env.js');
  return { providers, env: envModule.env };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getPrimaryProvider', () => {
  it('defaults to nim when AI_PROVIDER is unset', async () => {
    const { providers } = await loadProviders({});
    expect(providers.getPrimaryProvider().name).toBe('nim');
  });

  it('selects openrouter when AI_PROVIDER=openrouter and its key is set', async () => {
    const { providers } = await loadProviders({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
    });
    expect(providers.getPrimaryProvider().name).toBe('openrouter');
  });

  it('falls back to the first configured provider when AI_PROVIDER has no key', async () => {
    const { providers } = await loadProviders({ AI_PROVIDER: 'opencode' });
    expect(providers.getPrimaryProvider().name).toBe('nim');
  });
});

describe('getConfiguredProviders', () => {
  it('excludes providers without an API key', async () => {
    const { providers } = await loadProviders({});
    expect(providers.getConfiguredProviders().map((p: { name: string }) => p.name)).toEqual([
      'nim',
    ]);
  });

  it('includes openrouter and opencode when keys and base URL are set', async () => {
    const { providers } = await loadProviders({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENCODE_API_KEY: 'sk-oc-test',
      OPENCODE_BASE_URL: 'http://localhost:9999/v1',
    });
    expect(providers.getConfiguredProviders().map((p: { name: string }) => p.name)).toEqual([
      'nim',
      'openrouter',
      'opencode',
    ]);
  });
});

describe('resolveModel', () => {
  it('returns the provider model for the task', async () => {
    const { providers, env } = await loadProviders({});
    expect(providers.resolveModel(providers.getPrimaryProvider(), 'extraction')).toBe(
      env.NIM_MODEL_REASONING
    );
  });

  it('per-task override wins over the provider model', async () => {
    const { providers } = await loadProviders({ AI_MODEL_EXTRACTION: 'my-override' });
    expect(providers.resolveModel(providers.getPrimaryProvider(), 'extraction')).toBe(
      'my-override'
    );
  });

  it('returns the first element for comma-configured openrouter models', async () => {
    const { providers } = await loadProviders({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'model-a,model-b',
    });
    const openrouter = providers
      .getConfiguredProviders()
      .find((p: { name: string }) => p.name === 'openrouter');
    if (!openrouter) throw new Error('openrouter should be configured');
    expect(providers.resolveModel(openrouter, 'extraction')).toBe('model-a');
  });

  it('throws when the provider has no model for the task', async () => {
    const { providers } = await loadProviders({});
    expect(() => providers.resolveModel(providers.getPrimaryProvider(), 'lesson_plan')).toThrow(
      /No model configured/
    );
  });

  it('uses the opencode model envs when opencode is configured', async () => {
    const { providers } = await loadProviders({
      OPENCODE_API_KEY: 'sk-oc-test',
      OPENCODE_BASE_URL: 'http://localhost:9999/v1',
      OPENCODE_MODEL_EXTRACTION: 'oc-extract-model',
      OPENCODE_MODEL_OCR: 'oc-ocr-model',
    });
    const opencode = providers
      .getConfiguredProviders()
      .find((p: { name: string }) => p.name === 'opencode');
    if (!opencode) throw new Error('opencode should be configured');
    expect(providers.resolveModel(opencode, 'extraction')).toBe('oc-extract-model');
    expect(providers.resolveModel(opencode, 'ocr')).toBe('oc-ocr-model');
  });
});

describe('resolveModelList', () => {
  it('returns the override as a single-element list', async () => {
    const { providers } = await loadProviders({ AI_MODEL_EXTRACTION: 'override' });
    expect(providers.resolveModelList(providers.getPrimaryProvider(), 'extraction')).toEqual([
      'override',
    ]);
  });

  it('returns the full array for comma-configured openrouter models', async () => {
    const { providers } = await loadProviders({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL_EXTRACTION: 'model-a,model-b',
    });
    const openrouter = providers
      .getConfiguredProviders()
      .find((p: { name: string }) => p.name === 'openrouter');
    if (!openrouter) throw new Error('openrouter should be configured');
    expect(providers.resolveModelList(openrouter, 'extraction')).toEqual(['model-a', 'model-b']);
  });

  it('returns undefined for providers with a plain string model', async () => {
    const { providers } = await loadProviders({});
    expect(providers.resolveModelList(providers.getPrimaryProvider(), 'extraction')).toBeUndefined();
  });
});
