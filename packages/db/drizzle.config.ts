import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // biome-ignore lint/style/noNonNullAssertion: already handled, safe to ignore
  dbCredentials: { url: process.env.DATABASE_URI! },
});
