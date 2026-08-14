import { env } from '../../config/env.js';

export type TaskType = 'extraction' | 'ocr' | 'lesson_plan' | 'summative_test' | 'image';

export const TASK_TYPES: TaskType[] = [
  'extraction',
  'ocr',
  'lesson_plan',
  'summative_test',
  'image',
];

export type ProviderName = 'nim' | 'openrouter' | 'opencode';

export interface ProviderConfig {
  name: ProviderName;
  baseURL: string | null;
  apiKey: string | null;
  models: Partial<Record<TaskType, string | string[]>>;
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Comma-separated env value → model list. OpenRouter sends the whole list as
// its native `models` fallback array; NIM/Opencode use the first entry only.
function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

const ALL_PROVIDERS: ProviderConfig[] = [
  {
    name: 'nim',
    baseURL: env.NVIDIA_NIM_BASE_URL,
    apiKey: env.NVIDIA_API_KEY,
    models: {
      extraction: env.NIM_MODEL_REASONING,
      ocr: env.NIM_MODEL_OCR,
      image: env.NIM_MODEL_IMAGE,
    },
  },
  {
    name: 'openrouter',
    baseURL: OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY ?? null,
    models: {
      extraction: splitList(env.OPENROUTER_MODEL_EXTRACTION),
      ocr: splitList(env.OPENROUTER_MODEL_OCR),
      lesson_plan: splitList(env.OPENROUTER_MODEL_LESSON_PLAN),
      summative_test: splitList(env.OPENROUTER_MODEL_SUMMATIVE_TEST),
      image: splitList(env.OPENROUTER_MODEL_IMAGE),
    },
  },
  {
    name: 'opencode',
    baseURL: env.OPENCODE_BASE_URL ?? null,
    apiKey: env.OPENCODE_API_KEY ?? null,
    models: {
      extraction: env.OPENCODE_MODEL_EXTRACTION,
      ocr: env.OPENCODE_MODEL_OCR,
      lesson_plan: env.OPENCODE_MODEL_LESSON_PLAN,
      summative_test: env.OPENCODE_MODEL_SUMMATIVE_TEST,
      image: env.OPENCODE_MODEL_IMAGE,
    },
  },
];

export function getConfiguredProviders(): ProviderConfig[] {
  return ALL_PROVIDERS.filter((p) => p.apiKey !== null && p.baseURL !== null);
}

export function getPrimaryProvider(): ProviderConfig {
  const configured = getConfiguredProviders();
  const preferred = configured.find((p) => p.name === env.AI_PROVIDER);
  const primary = preferred ?? configured[0];
  if (!primary) {
    throw new Error('No AI provider configured — set at least one provider API key');
  }
  return primary;
}

const TASK_OVERRIDES: Record<TaskType, string | undefined> = {
  extraction: env.AI_MODEL_EXTRACTION,
  ocr: env.AI_MODEL_OCR,
  lesson_plan: env.AI_MODEL_LESSON_PLAN,
  summative_test: env.AI_MODEL_SUMMATIVE_TEST,
  image: env.AI_MODEL_IMAGE,
};

export function resolveModel(provider: ProviderConfig, task: TaskType): string {
  const override = TASK_OVERRIDES[task];
  if (override) return override;
  const configured = provider.models[task];
  if (typeof configured === 'string') return configured;
  if (Array.isArray(configured)) {
    const first = configured[0];
    if (first) return first;
  }
  throw new Error(`No model configured for task "${task}" on provider "${provider.name}"`);
}

export function resolveModelList(provider: ProviderConfig, task: TaskType): string[] | undefined {
  const override = TASK_OVERRIDES[task];
  if (override) return [override];
  const configured = provider.models[task];
  return Array.isArray(configured) ? configured : undefined;
}
