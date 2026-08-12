import z from 'zod'

const envSchema = z.object({
  NVIDIA_API_KEY: z.coerce.string('Invalid or Missing NVIDIA_API_KEY'),
  NVIDIA_NIM_BASE_URL: z.url().default('https://integrate.api.nvidia.com/v1'),

  NIM_MODEL_REASONING: z.coerce
    .string()
    .nonempty('No value provided')
    .default('nvidia/nemotron-3-ultra-550b-a55b'),

  // For Filipino specific subjects/tasks
  OPENROUTER_MODEL_FILIPINO: z.coerce
    .string()
    .nonempty('No value provided')
    .default('openai/gpt-oss-20b:free'),

  // For slide illustrations generation
  NIM_MODEL_IMAGE: z.coerce.string().nonempty('No value provided').default('qwen/qwen-image'),

  // Fallback for pdf text extraction (also used as vision model for image-based fallback)
  NIM_MODEL_OCR: z.coerce.string().nonempty('No value provided').default('nvidia/nemotron-ocr-v2'),

  NODE_ENV: z.enum(['production', 'development', 'test']),
  PORT: z.coerce.number().int(),
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>
