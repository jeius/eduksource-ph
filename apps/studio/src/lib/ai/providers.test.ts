import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadProviders(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv('AI_PROVIDER', undefined);
  vi.stubEnv('OPENROUTER_API_KEY', undefined);
  vi.stubEnv('OPENCODE_API_KEY', undefined);
  vi.stubEnv('OPENCODE_BASE_URL', undefined);
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
