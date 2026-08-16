# EdukSource Studio

AI generation pipeline: turns a DepEd Budget of Work (BOW) PDF into draft teaching materials. Hono on Node.

## Setup

From the repo root:

```bash
pnpm install
pnpm build:packages
```

Create `apps/studio/.env` with the required vars (full schema in `apps/studio/src/config/env.ts`):

- `NIM_API_KEY` — NIM provider key (required)
- `PORT` — server port
- `NODE_ENV` — `development` | `production` | `test`

Optional:

- `AI_PROVIDER` — `nim` (default) | `openrouter` | `opencode`
- `AI_MODEL_EXTRACTION`, `AI_MODEL_OCR`, `AI_MODEL_LESSON_PLAN`, `AI_MODEL_SUMMATIVE_TEST`, `AI_MODEL_IMAGE` — per-task model overrides
- `NIM_BASE_URL`, `NIM_MODEL_EXTRACTION`, `NIM_MODEL_OCR`, `NIM_MODEL_LESSON_PLAN`, `NIM_MODEL_SUMMATIVE_TEST`, `NIM_MODEL_IMAGE` — primary provider (per-task keys default to NIM's default models if unset)
- `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_EXTRACTION`, `OPENROUTER_MODEL_OCR`, `OPENROUTER_MODEL_LESSON_PLAN`, `OPENROUTER_MODEL_SUMMATIVE_TEST`, `OPENROUTER_MODEL_IMAGE` — secondary provider (comma-separated values = OpenRouter native model fallback array)
- `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`, `OPENCODE_MODEL_EXTRACTION`, `OPENCODE_MODEL_OCR`, `OPENCODE_MODEL_LESSON_PLAN`, `OPENCODE_MODEL_SUMMATIVE_TEST`, `OPENCODE_MODEL_IMAGE` — tertiary provider

## Run

```bash
pnpm dev --filter=@eduksource/studio
```

Server on http://localhost:$PORT.

## Endpoints

- `GET /health` — liveness
- `GET /health/nim` — primary AI provider ping
- `GET /health/nim/stream` — streaming ping
- `GET /health/providers` — configured providers + per-task models
- `POST /api/extract` — multipart `file` (PDF) → structured BOW JSON

## Test / Build

```bash
pnpm test --filter=@eduksource/studio
pnpm build --filter=@eduksource/studio
```

## Deploy

Fly.io — see `fly.toml` and `Dockerfile`.
