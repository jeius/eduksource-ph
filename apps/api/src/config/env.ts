import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URI: z
    .string()
    .min(1)
    .regex(/^postgres/),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  DATABASE_URI: string;
  INTERNAL_SERVICE_TOKEN: string;
};

export function parseEnv(raw: Record<string, unknown>): AppEnv {
  return EnvSchema.parse(raw);
}
