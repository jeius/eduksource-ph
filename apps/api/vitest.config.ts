import { baseConfig } from '@eduksource/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
