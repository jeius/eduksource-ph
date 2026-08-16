import { baseConfig } from '@eduksource/config/vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

const env = config({ path: resolve(import.meta.dirname, '.env.test') });

export default defineConfig({
  ...baseConfig,
  test: { ...baseConfig.test, env: env.parsed, environment: 'node', setupFiles: [] },
});
