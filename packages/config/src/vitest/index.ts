export { baseConfig } from "./base-config.js";
export { uiConfig } from "./ui-config.js";

export const sharedConfig = {
  test: {
    globals: true,
    reporters: ['default', 'blob'],
    outputFile: {
      blob: 'coverage/blob/report.json',
    },
    coverage: {
      provider: 'istanbul' as const,
      enabled: true,
    },
    passWithNoTests: true,
  },
};