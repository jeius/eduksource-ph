import z from 'zod';

const envSchema = z.object({
  NVIDIA_API_KEY: z.coerce.string('Invalid or Missing NVIDIA_API_KEY'),
  NVIDIA_NIM_BASE_URL: z.url().default('https://integrate.api.nvidia.com/v1'),

  NIM_MODEL_REASONING: z.coerce
    .string()
    .nonempty('No value provided')
    .default('nvidia/nemotron-3-ultra-550b-a55b'),

  // For slide illustrations generation
  NIM_MODEL_IMAGE: z.coerce.string().nonempty('No value provided').default('qwen/qwen-image'),

  // Fallback for pdf text extraction (also used as vision model for image-based fallback)
  NIM_MODEL_OCR: z.coerce.string().nonempty('No value provided').default('nvidia/nemotron-ocr-v2'),

  // Provider registry — active provider + per-task model overrides
  AI_PROVIDER: z.enum(['nim', 'openrouter', 'opencode']).default('nim'),
  AI_MODEL_EXTRACTION: z.string().optional(),
  AI_MODEL_OCR: z.string().optional(),
  AI_MODEL_LESSON_PLAN: z.string().optional(),
  AI_MODEL_SUMMATIVE_TEST: z.string().optional(),
  AI_MODEL_IMAGE: z.string().optional(),

  // Optional secondary/tertiary providers — skipped when the key is absent.
  // Comma-separated model values: extra entries become OpenRouter's native
  // `models` fallback array (NIM/Opencode use the first entry only).
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL_EXTRACTION: z.string().optional(),
  OPENROUTER_MODEL_OCR: z.string().optional(),
  OPENROUTER_MODEL_LESSON_PLAN: z.string().optional(),
  OPENROUTER_MODEL_SUMMATIVE_TEST: z.string().optional(),
  OPENROUTER_MODEL_IMAGE: z.string().optional(),
  OPENCODE_API_KEY: z.string().optional(),
  OPENCODE_BASE_URL: z.url().optional(),
  OPENCODE_MODEL_EXTRACTION: z.string().optional(),
  OPENCODE_MODEL_OCR: z.string().optional(),
  OPENCODE_MODEL_LESSON_PLAN: z.string().optional(),
  OPENCODE_MODEL_SUMMATIVE_TEST: z.string().optional(),
  OPENCODE_MODEL_IMAGE: z.string().optional(),

  NODE_ENV: z.enum(['production', 'development', 'test']),
  PORT: z.coerce.number().int(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
