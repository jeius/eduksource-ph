import { sharedConfig } from '@eduksource/config/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  ...sharedConfig,
  test: {
    passWithNoTests: true,
    projects: [
      {
        root: './packages',
        test: {
          ...sharedConfig.test,
          // Project-specific configuration for packages
          // ...
        },
      },
      {
        root: './apps',
        test: {
          ...sharedConfig.test,
          // Project-specific configuration for apps
          environment: 'jsdom',
        },
      },
    ],
  },
})
