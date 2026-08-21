# apps/studio — AI Generation Pipeline (Node, admin/editor-only)

Hono on Node. Turns a BOW PDF into draft teaching materials. Deployed to Fly.io (fly.toml), separate runtime and deploy pipeline from the platform (Cloudflare Workers). See ADR-0001.

## Runtime & deployment (ADR-0001)

- Node, not Workers. Don't "simplify" onto Workers — memory/CPU limits and native-module constraints make PDF/PPTX/DOCX generation impractical.
- Fly.io (fly.toml, region sin), scale-to-zero auto-stop. Separate deploy pipeline from platform.

## Service-to-service auth

- admin↔studio = internal service token, NOT BetterAuth session. Don't assume session cookies available inside studio.

## AI provider registry (ADR-0002)

- All AI calls go through `apps/studio/src/lib/ai/` registry. Never direct hardcoded provider client at a call site.
- Provider/model swappable via config (AI_PROVIDER, AI_MODEL_* env). Three providers: NIM (primary), OpenRouter (secondary), Opencode (tertiary).
- Per-task overrides: AI_MODEL_EXTRACTION, AI_MODEL_OCR, AI_MODEL_LESSON_PLAN, AI_MODEL_SUMMATIVE_TEST, AI_MODEL_IMAGE.

## No Postgres access (ADR-0003)

- studio never imports `packages/db`, never gets a DB connection.
- Uploads generated files directly to R2 via S3-compatible API (own credentials, separate client).
- Persists product metadata by calling api's `/internal/*` endpoints (service token).

## Route contracts

- `GET /health` — liveness
- `GET /health/chat` — primary AI provider ping
- `GET /health/chat/stream` — streaming ping
- `GET /health/providers` — configured providers + per-task models
- `POST /api/extract` — multipart `file` (PDF) → structured BOW JSON. Side effects: R2 upload (when extraction is durable per ADR-0007/0008) + api internal call to persist metadata.

## Extraction identity (ADR-0007/0008)

- Identity = normalized-text hash (ADR-0008), with catalog safety net.
- Extractions are durable, api-owned records keyed by content hash (ADR-0007).
- studio computes the identity; api persists it.

## Slide content (ADR-0006)

- Slide content generated from the lesson plan, NOT the raw BOW. Don't feed raw BOW to slide generation.

## Env-var discipline

- Full schema in `src/config/env.ts`; never hardcode keys. See README for AI_MODEL_* overrides.

## Local ADR index

| ADR | Governs | Location |
| --- | --- | --- |
| [0002](docs/adr/0002-swappable-ai-provider-registry.md) | AI provider registry — NIM/OpenRouter/Opencode, swappable by config | `apps/studio/docs/adr/` |
| [0003](docs/adr/0003-studio-no-direct-db-access.md) | studio has no Postgres access; goes through api's internal endpoint | `apps/studio/docs/adr/` |
| [0006](docs/adr/0006-slide-content-chained-off-lesson-plan.md) | Slide content generated from the lesson plan, not the raw BOW | `apps/studio/docs/adr/` |
| [0007](docs/adr/0007-bow-extractions-durable-content-hash.md) | BOW extractions are durable, api-owned records keyed by content hash | `apps/studio/docs/adr/` |
| [0008](docs/adr/0008-bow-extraction-normalized-text-hash.md) | BOW extraction identity = normalized-text hash, with catalog safety net | `apps/studio/docs/adr/` |

## Pointer to root

Cross-cutting rules (commands, conventions, commit style, trunk-based, ADR process, flag-not-work-around) → root `AGENTS.md`. Domain map → `CONTEXT-MAP.md`.
