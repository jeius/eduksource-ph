# EdukSource PH — Tech Stack

Source of truth for chosen languages, frameworks, libraries, and tools. If a dependency is added or swapped, update this table.

| Layer                 | Choice                                                       | Notes                                                                                     |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Monorepo               | Turborepo + pnpm workspaces                                   |                                                                                                |
| Frontend framework     | Tanstack Start                                                 | store, admin, docs                                                                            |
| UI components          | shadcn-ui                                                       | shared `packages/ui`                                                                          |
| API framework          | Hono                                                            | used by **both** `api` (Workers) and `studio` (Node) — same framework, two runtimes           |
| Compute (store/admin/api/docs) | Cloudflare Workers                                    |                                                                                                |
| Compute (studio)       | **Node**, separate host (Fly.io, `docs/architecture.md` §2.4)  | Workers' 128MB memory cap + CPU limits are a poor fit for PDF/PPTX/DOCX assembly              |
| File storage           | Cloudflare R2                                                   | signed/expiring URLs only; `api` uses native R2 binding, `studio` uses R2's S3-compatible API |
| Background jobs        | Cloudflare Queues                                               | watermarking, preview generation, email sending, webhook processing (platform side)           |
| Database               | Supabase (Postgres)                                             | temporary; migrate path TBD (ADR-0004)                                                        |
| ORM                    | Drizzle                                                         | lives in `packages/db`, **owned exclusively by `api`** — see `docs/architecture.md` §2.3      |
| Validation              | Zod                                                             | shared schemas in `packages/schemas`, used client + server + by `studio`                      |
| Auth                   | BetterAuth                                                      | shared session across store/admin/api; `studio` uses a separate internal service-auth scheme, `docs/architecture.md` §4 |
| AI inference (studio)  | **Swappable**: NVIDIA NIM, OpenRouter, Opencode Go              | OpenAI-compatible clients behind one internal provider registry — ADR-0002, `docs/architecture.md` §3 |
| PDF extraction (studio)| `unpdf` + `pdfjs-dist` (legacy build), vision-model fallback for scanned PDFs (`@napi-rs/canvas` page rendering) |                                                                                              |
| PPTX generation         | `pptxgenjs`                                                     |                                                                                                |
| DOCX generation         | `docx` (npm)                                                    |                                                                                                |
| Payments (primary)     | **PayMongo**                                                    | GCash, Maya, GrabPay, cards — PH-first, PH-compliant receipts (ADR-0005)                       |
| Payments (secondary)   | Stripe                                                          | international buyers                                                                           |
| Email                  | Resend + react-email                                            | transactional templates                                                                        |
| Domain                 | NameCheap → Cloudflare DNS                                      |                                                                                                |
| Bot/spam protection    | Cloudflare Turnstile                                            | checkout, signup, contact forms                                                                |
| Error tracking         | Sentry                                                          | all apps, including `studio`                                                                    |
| Analytics              | PostHog or Plausible                                            | conversion funnel, cart abandonment                                                             |
| Search                 | Postgres full-text (Drizzle) → Meilisearch/Typesense later      | upgrade only if catalog grows large                                                             |
| Testing                | Vitest (unit/integration), Playwright (e2e)                     | checkout flow + studio pipeline are the priority e2e paths                                     |
| Lint/format            | Biome                                                           |                                                                                                |
| Package manager        | pnpm                                                            |                                                                                                |
| API docs               | `@hono/zod-openapi` → OpenAPI spec → rendered in `docs`          | generated from the same Zod schemas you're already writing, not hand-maintained                |

## Library Guides

Usage guides for installed libraries live in `docs/libraries/` — one file per library (e.g. `docs/libraries/hono.md`, `docs/libraries/loglayer.md`). Add a guide when a library has non-obvious setup or patterns worth remembering; agents refer to these instead of rediscovering usage. Model notes live in `docs/models/` (`docs/models/QWEN_IMAGE.md`).
