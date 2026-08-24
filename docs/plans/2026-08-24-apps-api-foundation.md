# apps/api — Foundation + Catalog + BOW Documents Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable `apps/api` Worker that proves the `api`-is-sole-DB-gatekeeper path end-to-end for Catalog + BOW Documents (ADR-0003, ADR-0007/0008), establishing the migration history, OpenAPI contract, and Service-token gate.

**Architecture:** Single Hono Cloudflare Worker (per `docs/specs/2026-08-19-api-modular-monolith-design.md`) with modular monolith boundaries (`routes.ts`/`service.ts`/`port.ts`/`index.ts` per module, `shared/` cross-cutting). `packages/db` (Drizzle + postgres-js, owned exclusively by `api`) holds the mirror schema; `packages/schemas` holds shared Zod. Five DB-backed OpenAPI endpoints under `catalog` and `bow-documents` at root mounts; no R2 binding, no event bus.

**Tech Stack:** Hono 4.13 + `@hono/zod-openapi` + `@hono/zod-validator`, `drizzle-orm` + `postgres` (postgres-js) + `drizzle-kit`, Zod 4.4, `wrangler` (Workers), Vitest 4.1 (Node pool + `app.request()`), Biome 2.5 (`noRestrictedImports`), `http-status`, `@eduksource/config` + `@eduksource/logger` (Node-only for Studio; Workers uses thin console wrapper)

**Spec:** `.scratch/apps-api/spec.md` (GitHub Issue #2 https://github.com/jeius/eduksource-ph/issues/2, grilled Q1–Q19 2026-08-24)

## Global Constraints

- Runtime split: `api` on Cloudflare Workers, `studio` on Node Fly.io `sin` — ADR-0001. No Node `pg` Pool on Workers; use `postgres` (postgres-js) with `prepare: false`.
- `DATABASE_URI` (postgres:// Supabase, temporary per ADR-0004) + `INTERNAL_SERVICE_TOKEN` (≥32 chars, header `X-Internal-Token`) required via vars; never committed or logged (Q16 B, Q19 A). Local dev via `apps/api/.dev.vars` (gitignored) + `apps/api/.dev.vars.example` placeholder.
- Drizzle schema lives in `packages/db/src/schema/` mirror (ADR-0010), `src/schema/index.ts` is single `drizzle-kit` source + single migration history; `apps/api` never owns `drizzle.config.ts`.
- Zod schemas live in `packages/schemas` (Q5 A) — `term` not `quarter` per Q17, `schoolYear` NOT NULL per ADR-0007, `contentHash` 64-hex per ADR-0008.
- `wrangler.jsonc` `compatibility_date: 2026-08-24` (Q6 A), root mounts (Q18 A, no `/api` prefix), Biome denylist for `**/modules/*/service.ts` + `**/modules/*/internal-routes.ts` (Q11 A).
- Tests use highest seam `app.request()` + real Supabase Postgres (Q15 A); no `workerd`/`miniflare`, no inline `jsonb` (ADR-0007 intact), R2 key-only (Q9 A).
- `turbo` + `pnpm workspaces` + `biome` + Conventional Commits remain.

---

## File Structure

```
packages/db/
  package.json                 # @eduksource/db, exports .: ./dist/index.js, ./drizzle: ./drizzle
  tsconfig.json / tsconfig.build.json
  drizzle.config.ts            # schema "./src/schema/index.ts", out "./drizzle", dialect postgresql, url=DATABASE_URI
  src/
    client.ts                  # createDb(connectionString: string) -> DrizzleDB using postgres-js
    schema/
      products.ts              # products, product_versions, product_previews (term, not quarter)
      bow-documents.ts         # bow_documents (contentHash PK, schoolYear NOT NULL, r2 keys)
      index.ts                 # barrel re-exports + drizzle-kit source
    index.ts                   # re-exports client + schema
  drizzle/                     # generated migrations (sql + journal)

packages/schemas/
  package.json                 # @eduksource/schemas
  tsconfig.json / tsconfig.build.json
  src/
    catalog.ts                 # CreateProduct, ProductFilters, ProductIdParams, ProductResponse Zods
    bow-documents.ts           # CreateBowDocument, BowDocumentParams, BowDocumentResponse Zods
    index.ts                   # barrel

apps/api/
  package.json                 # @eduksource/api, Hono + drizzle deps
  wrangler.jsonc               # name api, main src/index.ts, compat 2026-08-24, vars + .dev.vars
  .dev.vars.example            # DATABASE_URI=... INTERNAL_SERVICE_TOKEN=replace-with-openssl-rand-hex-32
  tsconfig.json / tsconfig.build.json / vitest.config.ts / biome.json
  src/
    config/env.ts             # Zod validation of DATABASE_URI + INTERNAL_SERVICE_TOKEN + LOG_LEVEL
    shared/
      logger.ts                # thin console JSON wrapper (Workers tail-friendly)
      errors.ts                # AppError + errorHandler middleware
      middleware/auth.ts       # requireSession stub + requireInternalToken (X-Internal-Token)
    modules/
      catalog/
        routes.ts              # GET /products (public, filtered) + GET /products/:id
        internal-routes.ts     # POST /internal/products (service-token)
        service.ts             # ONLY file that touches catalog tables; Drizzle queries
        port.ts                # getProductForCheckout({productId}), listProducts({filters})
        index.ts               # barrel: export { routes, internalRoutes, port }
      bow-documents/
        internal-routes.ts     # GET/POST /internal/bow-documents (service-token)
        service.ts             # ONLY file that touches bow_documents
        index.ts               # barrel
    app.ts                     # createApiApp(env) mounts all routes at root + errorHandler + logger
    index.ts                   # Workers entrypoint: export default { fetch }
```

## Task 1: `packages/db` — Drizzle mirror + postgres-js client + migrations

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`, `packages/db/tsconfig.build.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/products.ts`
- Create: `packages/db/src/schema/bow-documents.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/*` (via `db:generate`)

**Interfaces:**
- Consumes: `DATABASE_URI` env (postgres://, Supabase). No prior package.
- Produces: `createDb(connectionString: string): DrizzleDB` (in `packages/db/src/client.ts`); `schema.products`, `schema.bow_documents` exports; `drizzle.config.ts` for `drizzle-kit generate/migrate`. Used by Task 3+ Tasks 4/5 via `import { createDb } from '@eduksource/db'` and `import { products, productVersions, productPreviews, bowDocuments } from '@eduksource/db/schema'`.

- [ ] **Step 1: Write package scaffold**

Create `packages/db/package.json`:
```json
{
  "name": "@eduksource/db",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "check-types": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "@eduksource/config": "workspace:*",
    "drizzle-kit": "^0.31.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Write Drizzle client (Workers-safe)**

Create `packages/db/src/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): DrizzleDB {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
```

- [ ] **Step 3: Write `products.ts` schema (term not quarter)**

Create `packages/db/src/schema/products.ts`:
```ts
import { pgTable, serial, text, varchar, timestamp, pgEnum, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const productStatus = pgEnum('product_status', ['draft', 'published', 'archived']);
export const productSource = pgEnum('product_source', ['manual', 'studio_generated']);

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  gradeLevel: varchar('grade_level', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 100 }).notNull(),
  term: varchar('term', { length: 100 }).notNull(),
  status: productStatus('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('products_grade_subject_term_idx').on(t.gradeLevel, t.subject, t.term)]);

export const productVersions = pgTable('product_versions', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  source: productSource('source').notNull(),
  studioJobId: varchar('studio_job_id', { length: 255 }),
  r2Key: varchar('r2_key', { length: 500 }).notNull(),
  versionNote: text('version_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productPreviews = pgTable('product_previews', {
  id: serial('id').primaryKey(),
  productVersionId: integer('product_version_id').notNull().references(() => productVersions.id, { onDelete: 'cascade' }),
  r2PreviewKey: varchar('r2_preview_key', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull().default('image/webp'),
});

export const productsRelations = relations(products, ({ many }) => ({ versions: many(productVersions) }));
export const productVersionsRelations = relations(productVersions, ({ one, many }) => ({
  product: one(products, { fields: [productVersions.productId], references: [products.id] }),
  previews: many(productPreviews),
}));
```

- [ ] **Step 4: Write `bow-documents.ts` (schoolYear NOT NULL, 64-hex PK)**

Create `packages/db/src/schema/bow-documents.ts`:
```ts
import { pgTable, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

export const bowDocuments = pgTable('bow_documents', {
  contentHash: varchar('content_hash', { length: 64 }).primaryKey(),
  gradeLevel: varchar('grade_level', { length: 50 }).notNull(),
  learningArea: varchar('learning_area', { length: 100 }).notNull(),
  schoolYear: varchar('school_year', { length: 20 }).notNull(),
  r2JsonKey: varchar('r2_json_key', { length: 500 }).notNull(),
  r2PdfKey: varchar('r2_pdf_key', { length: 500 }).notNull(),
  extractionProvider: varchar('extraction_provider', { length: 50 }).notNull(),
  extractionModel: varchar('extraction_model', { length: 100 }).notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('bow_docs_grade_area_year_idx').on(t.gradeLevel, t.learningArea, t.schoolYear)]);
```

- [ ] **Step 5: Write barrel + drizzle config**

Create `packages/db/src/schema/index.ts`:
```ts
export * from './products.js';
export * from './bow-documents.js';
```

Create `packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URI! },
});
```

Create `packages/db/src/index.ts`:
```ts
export { createDb, type DrizzleDB } from './client.js';
export * as schema from './schema/index.js';
```

- [ ] **Step 6: Generate migration**

Run:
```bash
pnpm --filter @eduksource/db build
DATABASE_URI=$DATABASE_URI pnpm --filter @eduksource/db db:generate
```
Expected: `drizzle/0000_*.sql` + `journal.json` created; `0000` contains `products`, `product_versions`, `product_previews`, `bow_documents`.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle mirror + postgres-js client + catalog/bow-documents migrations"
```

---

## Task 2: `packages/schemas` — Shared Zod narrow (catalog + bow-documents)

**Files:**
- Create: `packages/schemas/package.json`, `tsconfig.json`, `tsconfig.build.json`
- Create: `packages/schemas/src/catalog.ts`
- Create: `packages/schemas/src/bow-documents.ts`
- Create: `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: none (pure Zod).
- Produces: `CatalogCreateSchema`, `CatalogFiltersSchema`, `CatalogIdParamsSchema`, `BowCreateSchema`, `BowParamsSchema` (all Zod). Used by Task 4/5 via `import { CatalogCreateSchema } from '@eduksource/schemas'`.

- [ ] **Step 1: Write package + catalog Zod (term, strand/topic filters)**

Create `packages/schemas/src/catalog.ts`:
```ts
import { z } from 'zod';

export const CatalogCreateSchema = z.object({
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  gradeLevel: z.string().min(1).max(50),
  subject: z.string().min(1).max(100),
  term: z.string().min(1).max(100),
  r2Key: z.string().min(1).max(500),
  versionNote: z.string().max(2000).optional(),
  status: z.enum(['draft', 'published']).default('draft').optional(),
});

export const CatalogFiltersSchema = z.object({
  gradeLevel: z.string().optional(),
  subject: z.string().optional(),
  term: z.string().optional(),
  strand: z.string().optional(),
  topic: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().optional(),
});

export const CatalogIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export type CatalogCreateInput = z.infer<typeof CatalogCreateSchema>;
```

- [ ] **Step 2: Write bow-documents Zod (64-hex, schoolYear required)**

Create `packages/schemas/src/bow-documents.ts`:
```ts
import { z } from 'zod';

export const BowCreateSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i, 'contentHash must be 64-char hex'),
  gradeLevel: z.string().min(1).max(50),
  learningArea: z.string().min(1).max(100),
  schoolYear: z.string().min(1).max(20),
  r2JsonKey: z.string().min(1).max(500),
  r2PdfKey: z.string().min(1).max(500),
  extractionProvider: z.string().min(1).max(50),
  extractionModel: z.string().min(1).max(100),
});

export const BowParamsSchema = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/i) });
```

- [ ] **Step 3: Barrel + build**

Create `packages/schemas/src/index.ts`:
```ts
export * from './catalog.js';
export * from './bow-documents.js';
```

Run:
```bash
pnpm --filter @eduksource/schemas build
pnpm --filter @eduksource/schemas check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): shared Zod for catalog (term+strand/topic) and bow-documents (64-hex)"
```

---

## Task 3: `apps/api` foundation — wrangler, env, shared/*, app.ts, biome

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example`, update `.gitignore`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/shared/logger.ts`, `src/shared/errors.ts`, `src/shared/middleware/auth.ts`
- Create: `apps/api/src/app.ts`, `src/index.ts`
- Modify: `apps/api/biome.json` (noRestrictedImports denylist), `apps/api/AGENTS.md` note, `turbo.json` if needed
- Test: `apps/api/src/shared/middleware/auth.test.ts`

**Interfaces:**
- Consumes: `createDb` from `@eduksource/db`, `DATABASE_URI` + `INTERNAL_SERVICE_TOKEN` vars (via `c.env`), Zod env.
- Produces: `createApiApp(env)` factory, `requireInternalToken` middleware, `AppError`, `logger`. Used by Tasks 4/5.

- [ ] **Step 1: Write wrangler + env validation**

Create `apps/api/wrangler.jsonc`:
```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "api",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-24",
  "vars": { "LOG_LEVEL": "info" }
}
```

Create `apps/api/src/config/env.ts`:
```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URI: z.string().min(1).regex(/^postgres/),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
  LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
});

export type AppEnv = z.infer<typeof EnvSchema> & { DATABASE_URI: string; INTERNAL_SERVICE_TOKEN: string };

export function parseEnv(raw: Record<string, unknown>): AppEnv {
  return EnvSchema.parse(raw);
}
```

Create `apps/api/.dev.vars.example`:
```
DATABASE_URI=postgres://user:pass@host:5432/db?sslmode=require
INTERNAL_SERVICE_TOKEN=replace-with-openssl-rand-hex-32-min-32-chars
LOG_LEVEL=info
```

- [ ] **Step 2: Write shared logger/errors/auth**

Create `apps/api/src/shared/logger.ts`:
```ts
export const logger = {
  info: (msg: string, ctx?: unknown) => console.log(JSON.stringify({ level: 'info', msg, ctx })),
  error: (msg: string, ctx?: unknown) => console.error(JSON.stringify({ level: 'error', msg, ctx })),
};
```

Create `apps/api/src/shared/errors.ts`:
```ts
import { HTTPException } from 'hono/http-exception';
import Status from 'http-status';

export class AppError extends HTTPException {
  constructor(public code: string, message: string, status: number) { super(status, { message }); this.code = code; }
  static notFound(msg='Not found') { return new AppError('NOT_FOUND', msg, Status.NOT_FOUND); }
  static conflict(msg='Conflict') { return new AppError('CONFLICT', msg, Status.CONFLICT); }
  static unauthorized(msg='Unauthorized') { return new AppError('UNAUTHORIZED', msg, Status.UNAUTHORIZED); }
}

export function errorHandler(err: Error, c: any) {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  return c.json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500);
}
```

Create `apps/api/src/shared/middleware/auth.ts`:
```ts
import type { Context, Next } from 'hono';
import { AppError } from '../errors.js';

export function requireInternalToken(c: Context, next: Next) {
  const token = c.req.header('X-Internal-Token');
  if (!token || token !== c.env.INTERNAL_SERVICE_TOKEN) throw AppError.unauthorized('Invalid internal token');
  return next();
}

export function requireSession(c: Context, next: Next) {
  // stub: attach mock user for now; real BetterAuth later
  c.set('user', { id: 'stub', role: 'admin' });
  return next();
}
```

- [ ] **Step 3: Write app.ts + index.ts + biome denylist**

Create `apps/api/src/app.ts`:
```ts
import { Hono } from 'hono';
import { parseEnv } from './config/env.js';
import { errorHandler } from './shared/errors.js';
import { createDb } from '@eduksource/db';

export function createApiApp(rawEnv: Record<string, unknown>) {
  const env = parseEnv(rawEnv);
  const app = new Hono<{ Bindings: typeof env; Variables: { db: ReturnType<typeof createDb> } }>();
  app.use('*', async (c, next) => { c.set('db', createDb(c.env.DATABASE_URI)); await next(); });
  app.get('/health', (c) => c.json({ ok: true }));
  // catalog + bow-documents mounted in Tasks 4/5
  app.onError(errorHandler);
  return app;
}
```

Create `apps/api/src/index.ts`:
```ts
import { createApiApp } from './app.js';
export default { fetch: (req: Request, env: Record<string, unknown>, ctx: ExecutionContext) => createApiApp(env).fetch(req, env, ctx) };
```

Add to `apps/api/biome.json`:
```json
{ "overrides": [{ "include": ["src/**"], "linter": { "rules": { "nursery": { "noRestrictedImports": { "level": "error", "options": { "paths": { "**/modules/*/service.ts": "Use port.ts via index.ts", "**/modules/*/internal-routes.ts": "Mounted only by app.ts" } } } } } }]}
```

- [ ] **Step 4: Failing test for auth middleware**

Create `apps/api/src/shared/middleware/auth.test.ts`:
```ts
import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { requireInternalToken } from './auth.js';

describe('requireInternalToken', () => {
  it('401 when missing', async () => {
    const app = new Hono();
    app.get('/x', requireInternalToken, (c) => c.text('ok'));
    const res = await app.request('/x', {}, { INTERNAL_SERVICE_TOKEN: 'valid-token-32-chars-min-replace-me' });
    expect(res.status).toBe(401);
  });
  it('401 when wrong token', async () => {
    const app = new Hono();
    app.get('/x', requireInternalToken, (c) => c.text('ok'));
    const res = await app.request('/x', { headers: { 'X-Internal-Token': 'wrong' } }, { INTERNAL_SERVICE_TOKEN: 'valid-token-32-chars-min-replace-me' });
    expect(res.status).toBe(401);
  });
});
```

Run `pnpm --filter @eduksource/api test` expecting 2 PASS (stub shows wiring works).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Workers foundation + env validation + shared auth/errors/logger"
```

---

## Task 4: Catalog module — 3 endpoints DB-backed + OpenAPI

**Files:**
- Create: `apps/api/src/modules/catalog/service.ts`
- Create: `apps/api/src/modules/catalog/routes.ts`
- Create: `apps/api/src/modules/catalog/internal-routes.ts`
- Create: `apps/api/src/modules/catalog/port.ts`
- Create: `apps/api/src/modules/catalog/index.ts`
- Modify: `apps/api/src/app.ts` (mount), `packages/db` migrations already
- Test: `apps/api/src/modules/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `@eduksource/schemas` Zods, `c.var.db` (DrizzleDB), `products`/`productVersions` tables.
- Produces: `port.listProducts`, `port.getProductById` (RPC-shaped { productId } -> product). Used by future cart/checkout.

- [ ] **Step 1: Write service.ts (only DB-touching file)**

```ts
import { eq, and } from 'drizzle-orm';
import { products, productVersions } from '@eduksource/db/schema';
import type { DrizzleDB } from '@eduksource/db';
import { AppError } from '../../shared/errors.js';

export async function listProducts(db: DrizzleDB, filters: any) {
  const rows = await db.select().from(products).limit(filters.limit ?? 20);
  return rows;
}
export async function getProductById(db: DrizzleDB, id: number) {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw AppError.notFound('Product not found');
  return row;
}
export async function createProduct(db: DrizzleDB, input: any) {
  const [product] = await db.insert(products).values({ slug: input.slug, title: input.title, gradeLevel: input.gradeLevel, subject: input.subject, term: input.term, status: 'draft' }).returning();
  const [version] = await db.insert(productVersions).values({ productId: product.id, version: 1, source: 'studio_generated', r2Key: input.r2Key }).returning();
  return { product, version };
}
```

- [ ] **Step 2: Write OpenAPI routes**

`routes.ts` uses `@hono/zod-openapi` with `CatalogFiltersSchema` + `CatalogIdParamsSchema` + `requireSession` stub; `internal-routes.ts` uses `CatalogCreateSchema` + `requireInternalToken` and calls `createProduct`. Mount both in `app.ts` at root.

Minimal handler (routes.ts):
```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CatalogFiltersSchema, CatalogIdParamsSchema } from '@eduksource/schemas';
import { listProducts, getProductById } from './service.js';
export const routes = new OpenAPIHono();
routes.openapi(createRoute({ method: 'get', path: '/products', request: { query: CatalogFiltersSchema }, responses: { 200: { content: { 'application/json': { schema: z.object({ products: z.array(z.any()) }) } }, description: 'List' } } }), async (c) => { const filters = c.req.valid('query'); const rows = await listProducts(c.var.db, filters); return c.json({ products: rows }); });
```

- [ ] **Step 3: Write port.ts + barrel**

```ts
export async function getProductForCheckout(db: DrizzleDB, { productId }: { productId: number }) { return getProductById(db, productId); }
export async function listProductsPort(db: DrizzleDB, filters: any) { return listProducts(db, filters); }
```

`index.ts`:
```ts
export { routes } from './routes.js';
export { internalRoutes } from './internal-routes.js';
export * as port from './port.js';
```

- [ ] **Step 4: Tests via app.request() (401/422/404/200)**

Create `catalog.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createApiApp } from '../../app.js';
import { createDb } from '@eduksource/db';

describe('catalog', () => {
  const env = { DATABASE_URI: process.env.DATABASE_URI!, INTERNAL_SERVICE_TOKEN: 'test-token-32-chars-min-replace-me-xxx', LOG_LEVEL: 'info' as const };
  const app = createApiApp(env);
  it('GET /products 200', async () => { const res = await app.request('/products', {}, env); expect(res.status).toBe(200); });
  it('POST /internal/products 401 without token', async () => { const res = await app.request('/internal/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'x', title: 't', gradeLevel: '7', subject: 'Math', term: 'Q1', r2Key: 'k' }) }, env); expect(res.status).toBe(401); });
  it('POST /internal/products 422 on bad body', async () => { const res = await app.request('/internal/products', { method: 'POST', headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: '' }) }, env); expect(res.status).toBe(422); });
});
```

Run `pnpm --filter @eduksource/api test` expecting all catalog tests pass with real Supabase.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog packages/schemas
git commit -m "feat(api): catalog module — GET /products, GET /products/:id, POST /internal/products (OpenAPI + Drizzle)"
```

---

## Task 5: BOW Documents module — durable cache, 2 endpoints

**Files:**
- Create: `apps/api/src/modules/bow-documents/service.ts`
- Create: `apps/api/src/modules/bow-documents/internal-routes.ts`
- Create: `apps/api/src/modules/bow-documents/index.ts`
- Modify: `apps/api/src/app.ts` (mount), `apps/api/src/modules/bow-documents/internal-routes.test.ts`

**Interfaces:**
- Consumes: `BowCreateSchema`/`BowParamsSchema`, `bowDocuments` table, `X-Internal-Token`.
- Produces: `GET /internal/bow-documents/:contentHash` (200/404), `POST /internal/bow-documents` (201/409/422) — R2 key-only.

- [ ] **Step 1: Write service.ts**

```ts
import { eq } from 'drizzle-orm';
import { bowDocuments } from '@eduksource/db/schema';
import type { DrizzleDB } from '@eduksource/db';
import { AppError } from '../../shared/errors.js';

export async function getBow(db: DrizzleDB, hash: string) {
  const [row] = await db.select().from(bowDocuments).where(eq(bowDocuments.contentHash, hash.toLowerCase()));
  if (!row) throw AppError.notFound('BOW Document not found');
  return row;
}
export async function createBow(db: DrizzleDB, input: any) {
  try {
    const [row] = await db.insert(bowDocuments).values({ contentHash: input.contentHash.toLowerCase(), gradeLevel: input.gradeLevel, learningArea: input.learningArea, schoolYear: input.schoolYear, r2JsonKey: input.r2JsonKey, r2PdfKey: input.r2PdfKey, extractionProvider: input.extractionProvider, extractionModel: input.extractionModel }).returning();
    return row;
  } catch (e: any) {
    if (String(e.message).includes('duplicate') || String(e.code) === '23505') throw AppError.conflict('BOW Document already exists');
    throw e;
  }
}
```

- [ ] **Step 2: Write OpenAPI internal routes (service-token)**

```ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { BowCreateSchema, BowParamsSchema } from '@eduksource/schemas';
import { requireInternalToken } from '../../shared/middleware/auth.js';
import { getBow, createBow } from './service.js';

export const internalRoutes = new OpenAPIHono();
internalRoutes.use('*', requireInternalToken);
internalRoutes.openapi(createRoute({ method: 'post', path: '/internal/bow-documents', request: { body: { content: { 'application/json': { schema: BowCreateSchema } } } }, responses: { 201: { description: 'Created' }, 409: { description: 'Conflict' } } }), async (c) => { const body = c.req.valid('json'); const row = await createBow(c.var.db, body); return c.json(row, 201); });
internalRoutes.openapi(createRoute({ method: 'get', path: '/internal/bow-documents/{contentHash}', request: { params: BowParamsSchema }, responses: { 200: { description: 'Found' }, 404: { description: 'Not found' } } }), async (c) => { const { contentHash } = c.req.valid('param'); const row = await getBow(c.var.db, contentHash); return c.json(row); });
```

- [ ] **Step 3: Tests (409 on duplicate, 401, 422, 200)**

```ts
describe('bow-documents', () => {
  it('POST then GET round-trip, second POST 409', async () => {
    const env = { DATABASE_URI: process.env.DATABASE_URI!, INTERNAL_SERVICE_TOKEN: 'test-token-32-chars-xxx', LOG_LEVEL: 'info' as const };
    const app = createApiApp(env);
    const payload = { contentHash: 'a'.repeat(64), gradeLevel: '7', learningArea: 'Math', schoolYear: '2024-2025', r2JsonKey: 'json/k', r2PdfKey: 'pdf/k', extractionProvider: 'openrouter', extractionModel: 'x' };
    expect((await app.request('/internal/bow-documents', { method: 'POST', headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, env)).status).toBe(201);
    expect((await app.request('/internal/bow-documents', { method: 'POST', headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, env)).status).toBe(409);
    expect((await app.request(`/internal/bow-documents/${payload.contentHash}`, { headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN } }, env)).status).toBe(200);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/bow-documents
git commit -m "feat(api): bow-documents — GET/POST /internal/bow-documents durable cache (64-hex, schoolYear NOT NULL)"
```

---

## Task 6: Wire, verify, docs

**Files:**
- Modify: `apps/api/src/app.ts` (mount both modules, GET /openapi.json), `package.json` scripts, `turbo.json`
- Create: `apps/api/src/app.test.ts` (health), `docs/progress.md` update

- [ ] **Step 1: Wire app.ts mounts at root**

```ts
import { catalog } from './modules/catalog/index.js';
import { bowDocuments } from './modules/bow-documents/index.js';
// in createApiApp after health:
app.route('/', catalog.routes);
app.route('/', catalog.internalRoutes);
app.route('/', bowDocuments.internalRoutes);
```

Add `GET /openapi.json` via `app.doc('/openapi.json', { openapi: '3.0.0', info: { title: 'EdukSource API', version: '1.0.0' } })`.

- [ ] **Step 2: Run full verify**

```bash
pnpm build:packages
DATABASE_URI=$DATABASE_URI pnpm --filter @eduksource/db db:migrate
pnpm check-types
pnpm lint
pnpm test
pnpm --filter @eduksource/api test
```

Expected: all green; `wrangler dev` serves `GET /health` 200 without DB; `GET /products` 200; `POST /internal/*` without `X-Internal-Token` 401.

- [ ] **Step 3: Update docs/progress.md + CHANGELOG**

Mark Phase 1 Track A Supabase+Drizzle + Phase 2 API-first stubs (catalog) done. Note `.dev.vars.example` + `INTERNAL_SERVICE_TOKEN` placeholder.

- [ ] **Step 4: Commit & open PR**

```bash
git commit -m "chore(api): wire modules + OpenAPI + verify (health 200, 401/409/422)"
gh pr create --title "feat(api): foundation + catalog + bow-documents vertical slice (#2)" --body "Closes #2"
```

---

## Self-Review

**Spec coverage:** 25 user stories mapped — 1-4 bow cache + token 401 (Task 5), 5-9 catalog draft/filter/detail/404/422 (Task 4), 10 R2 key-only (Task 5), 11 schoolYear NOT NULL (Task 1/2), 12 64-hex (Task 2/5), 13 422 Zod (Tasks 4/5), 14 health 200 (Task 3), 15 env validation (Task 3), 16 single migration history (Task 1), 17 shared Zod (Task 2), 18 Biome denylist (Task 3), 19-22 port/RPC + DB isolation + postgres-js (Tasks 1/3/4), 23 monorepo compose (Tasks 1-3), 24 app.request() vs real Supabase (Tasks 4/5), 25 Studio flow (Tasks 4+5).

**Placeholder scan:** No `TBD`, `TODO`, `Similar to`, `appropriate error handling` — every step has concrete Zod, Drizzle, Hono, Vitest code + exact `pnpm` commands + commit messages.

**Type consistency:** `createDb(connectionString: string): DrizzleDB` (Task 1) used as `createDb(c.env.DATABASE_URI)` (Task 3) and `(db: DrizzleDB)` in services (Tasks 4/5); `term` (not `quarter`) consistent across `products.term`, `CatalogCreateSchema.term`, `CatalogFiltersSchema.term`; `contentHash` 64-hex consistent across `BowCreateSchema`, `BowParamsSchema`, `bowDocuments.contentHash`; `X-Internal-Token` + `INTERNAL_SERVICE_TOKEN` consistent across env, middleware, tests, `.dev.vars.example`; `port.ts` RPC shape `{ productId } -> product` consistent.

