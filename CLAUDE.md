# CLAUDE.md

Operational guide for Claude Code working in this repo. For architecture, feature scope, and roadmap, see `PROJECT_PLAN.md` — read it first if you haven't already.

---

## Project snapshot

EdukSource PH — a Turborepo monorepo for a digital marketplace selling DepEd Budget-of-Work-aligned teaching materials.

Apps: `store` (customer), `admin` (internal), `api` (Hono/Workers), `docs`.
Packages: `ui`, `db`, `auth`, `email`, `schemas`, `config`.

---

## Commands

```bash
pnpm install              # install all workspace deps
pnpm dev                  # run all apps in dev mode
pnpm dev --filter=store   # run a single app
pnpm build                # build all apps
pnpm lint                 # biome lint
pnpm format                # biome format
pnpm typecheck             # tsc across workspaces
pnpm test                  # vitest (unit/integration)
pnpm test:e2e               # playwright
pnpm db:generate            # drizzle-kit generate migration
pnpm db:migrate             # apply migrations
pnpm db:studio              # drizzle studio
```

(Update this list as real scripts are added to `package.json` — keep it in sync, don't let it drift.)

---

## Conventions

### General

- Package manager is **pnpm** — never use npm or yarn commands or lockfiles.
- Formatting/linting is **Biome**, not ESLint/Prettier. Run `pnpm format` before considering a task done.
- TypeScript strict mode everywhere. No `any` unless explicitly justified with a comment.
- Shared logic goes in `packages/`, not duplicated across apps. If two apps need the same Zod schema, type, or util, it belongs in `packages/schemas` or a new shared package — don't copy-paste.

### API (`apps/api`)

- Built on **Hono**, deployed to **Cloudflare Workers** — don't introduce Node-only APIs (`fs`, `net`, etc.) that won't run on Workers.
- Every route input is validated with **Zod** using schemas from `packages/schemas`. No unvalidated request bodies.
- Auth is handled via **BetterAuth** — don't roll custom session/token logic.
- Long-running or non-critical-path work (watermarking, preview generation, emails) goes through **Cloudflare Queues**, not inline in the request handler.

### Database (`packages/db`)

- Schema lives in Drizzle, one schema file per domain area (e.g. `products.ts`, `orders.ts`) rather than one giant file.
- Every schema change goes through `drizzle-kit generate` — never hand-edit migration files.
- Foreign keys and cascade behavior should be explicit; don't rely on app-level cleanup for referential integrity where the DB can enforce it.

### Frontend (`apps/store`, `apps/admin`)

- Built on **Tanstack Start**. Shared UI components go in `packages/ui` (shadcn-ui based) — don't build one-off duplicate components in an individual app if it's reusable.
- Server state (products, orders, etc.) fetched through Tanstack Query against the `api` app, not direct DB access from the frontend.
- Forms validated client-side with the same Zod schemas used server-side.

### Payments

- **PayMongo is primary** (GCash, Maya, cards) — build and test this path first.
- **Stripe is secondary**, for international buyers — don't let Stripe-specific assumptions leak into shared checkout logic; keep payment providers behind a common interface.
- Never log full payment payloads or card/wallet details. Webhook signatures must always be verified before processing.

### File handling

- Product files live in **R2**, never served via public bucket URLs — always generate signed, expiring URLs at download time.
- Watermarking and preview generation are async jobs (Queue-triggered), not synchronous steps in the purchase flow.
- File versioning: replacing a product's file must not break existing buyers' access to the version they purchased, unless the intent is an update-in-place (confirm intent before assuming).

### Testing

- New business logic (pricing, license generation, coupon math, checkout flow) needs Vitest coverage — don't ship untested logic in these areas.
- Checkout is the highest-priority Playwright e2e path. If you touch checkout, run the e2e suite before considering the task done.

### Security & compliance

- All customer PII handling should keep RA 10173 (PH Data Privacy Act) in mind — don't add new PII fields or third-party data sharing without flagging it.
- Turnstile protects checkout, signup, and contact/feedback forms — don't remove or bypass it when refactoring those flows.

---

## Working style for Claude Code in this repo

- Before starting a task, check `PROJECT_PLAN.md` to confirm which phase/feature the work belongs to. If a task seems out of sequence with the roadmap (e.g. building admin refund UI before checkout exists), flag it rather than proceeding silently.
- Prefer small, reviewable changes. For multi-file features, propose the file list and approach before writing code if the task is non-trivial.
- When a decision in `PROJECT_PLAN.md`'s "Open Questions" section blocks progress, stop and ask rather than assuming an answer.
- Don't introduce a new dependency not listed in the stack (`PROJECT_PLAN.md` §2) without flagging why the existing stack doesn't cover the need.
- Keep this file and `PROJECT_PLAN.md` updated when conventions or scope change — stale docs are worse than no docs.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
