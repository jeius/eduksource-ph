# EdukSource PH — System Architecture

Source of truth for system design, module boundaries, security, and data flow. Product scope lives in `docs/PRD.md`, roadmap in `docs/plan.md`, stack in `docs/tech-stack.md`.

---

## 1. Monorepo Layout

```txt
apps/
  store/        # Tanstack Start — customer storefront
  admin/        # Tanstack Start — admin dashboard (triggers + reviews studio jobs)
  api/          # Hono on Cloudflare Workers — sole owner of Postgres writes
  studio/       # Hono on Node — AI generation pipeline, admin/editor-only for now
  docs/         # Tanstack Start or static docs site
packages/
  ui/           # shared shadcn-ui components
  db/           # drizzle schema + migrations — used ONLY by api
  auth/         # betterAuth config, shared across api/store/admin
  email/        # resend templates (react-email)
  logger/       # shared logger (loglayer + pino) — use instead of console.log
  schemas/      # shared zod schemas — includes studio job + generated-product schemas
  config/       # shared tsconfig, biome config
```

**Note:** `studio` deliberately does **not** depend on `packages/db`. It talks to Postgres only indirectly, through `api`'s endpoints (§2.3). This keeps `api` as the single gatekeeper for product data, which matters once you have buyers whose access depends on that data being correct.

I'm intentionally *not* adding a shared `packages/ai` yet — only `studio` calls AI providers right now, so that logic lives inside `apps/studio`. Promote it to a shared package only if a second app needs it (e.g. if `admin` ever calls AI directly for something unrelated to Studio).

## 2. System Architecture

### 2.1 Context diagram

```
                         ┌──────────────┐
   Shopper (browser) ───▶│    store     │
                         └──────┬───────┘
                                │ REST (Zod-validated)
                                ▼
                         ┌──────────────┐        ┌─────────────┐
   Admin/Editor ────────▶│    admin     │───────▶│     api     │◀── auth (BetterAuth)
   (browser)             └──────┬───────┘        │  (Workers)  │
                                │                 └──────┬──────┘
                                │ trigger job             │ Drizzle
                                ▼                          ▼
                         ┌──────────────┐          ┌─────────────┐
                         │    studio    │          │  Supabase   │
                         │   (Node)     │          │ (Postgres)  │
                         └──────┬───────┘          └─────────────┘
                                │
                    ┌───────────┼────────────┐
                    ▼           ▼             ▼
              PDF extract   AI provider    R2 (S3 API)
              (unpdf +      registry:      direct upload
               pdfjs-dist +  NIM /          of generated
               vision        OpenRouter /   files
               fallback)     Opencode Go
```

### 2.2 Why two runtimes

`api`, `store`, `admin`, `docs` all run on Cloudflare Workers — cheap, fast cold starts, tightly integrated with R2/Queues. `studio` cannot: PDF parsing, PPTX/DOCX assembly, and multi-step LLM calls need Node's memory/CPU headroom and native module support that Workers' 128MB/CPU-time limits don't give you. **→ ADR-0001** (indexed in AGENTS.md).

### 2.3 Studio ↔ API data flow

1. Editor uploads a BOW PDF in `admin` → `admin` calls `studio` with an internal service token (§4).
2. `studio` runs the pipeline: extract → lesson plan (AI) → PPTX/DOCX assembly → summative/term exam (AI).
3. `studio` uploads all output files **directly to R2** via the S3-compatible API (`@aws-sdk/client-s3` pointed at R2's endpoint, R2 access-key credentials — separate from `api`'s native Workers R2 binding).
4. `studio` returns (or the `admin` app receives) the resulting R2 object keys + generation metadata (which AI provider/model was used, extracted objectives, etc.).
5. `admin` calls `api`'s `POST /internal/products` (or similar) with those R2 keys to create a **draft** product record + `product_versions` row. `api` is the only thing that ever writes to Postgres.
6. Editor reviews the draft in `admin`, edits if needed, publishes — same flow as a manually-created product from here on. No special-casing downstream.

This keeps the "api is sole DB gatekeeper" property intact while letting `studio` do the heavy lifting close to the files it's generating.

**Job model:** for the prototype, keep generation **synchronous** (submit → block → get result). Move to async job + polling (Phase 2 territory in `docs/plan.md`) once real generation times make blocking requests impractical — no need to build queueing infrastructure before you know you need it.

### 2.4 Deployment target (resolved)

`studio` runs on **Fly.io** (`apps/studio/fly.toml`, region `sin`) — chosen from the Fly.io / Cloud Run / Render candidates for its auto-stop machines, which give scale-to-zero without idle bills. Revisit only if cost or cold-start behavior changes at Phase 5+ scale.

## 3. AI Provider Strategy (Studio)

Since you want to swap providers/models opportunistically (NIM being unreliable at peak, OpenRouter and Opencode Go already in hand), build this as a **provider registry**, not a hardcoded client:

```ts
// apps/studio/src/lib/ai/providers.ts
type TaskType = "extraction" | "ocr" | "lesson_plan" | "summative_test" | "image";

type ProviderConfig = {
  baseURL: string;
  apiKey: string;
  models: Partial<Record<TaskType, string>>;
};

const providers: Record<string, ProviderConfig> = {
  nim:        { baseURL: process.env.NIM_BASE_URL!,        apiKey: process.env.NIM_API_KEY!,        models: {...} },
  openrouter: { baseURL: "https://openrouter.ai/api/v1",   apiKey: process.env.OPENROUTER_API_KEY!, models: {...} },
  opencode:   { baseURL: process.env.OPENCODE_BASE_URL!,   apiKey: process.env.OPENCODE_API_KEY!,   models: {...} },
};
```

- NIM and OpenRouter both expose OpenAI-compatible chat completion endpoints, so the standard `openai` npm client works against either just by swapping `baseURL`/`apiKey` — no need for a heavier SDK. **Opencode Go confirmed OpenAI-compatible too (2026-08-16)** — the same client works against all three providers unmodified, no adapter needed.
- Active provider selected via env var (`AI_PROVIDER=openrouter`), overridable per task (`AI_MODEL_LESSON_PLAN=...`) so you can e.g. run extraction on a cheap/fast model and lesson-plan generation on a stronger one, independent of which provider is "primary" this week.
- Add a simple fallback: if the primary provider errors or rate-limits, try the remaining configured providers in order (one attempt each). This directly addresses "NIM is unreliable at peak times" without you having to manually flip a switch mid-outage.
- OpenRouter specifically supports a `models: [...]` fallback array in a single request — worth using as your OpenRouter-internal fallback layer, with your own registry handling the *cross-provider* fallback (OpenRouter down entirely → try NIM/Opencode).
- **Revisit licensing terms** per-provider before this is generating materials that are actually sold — this was already flagged for NIM in the original plan; extend that check to whichever provider ends up primary. **→ ADR-0002** (indexed in AGENTS.md).

## 4. Security & Access Control

| Boundary | Mechanism |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Shopper ↔ store ↔ api | BetterAuth session (shared cookie/session across store/api) |
| Admin/editor ↔ admin ↔ api | BetterAuth session, role-checked (admin/editor) on every mutating `api` route |
| `admin` ↔ `studio` | **Internal service token** (shared secret, env-configured) — `studio` is not exposed to the public internet; only `admin` (and later `api`, if the callback flow needs it) holds the token |
| `studio` ↔ R2 | R2 API token (Account ID + Access Key ID + Secret) scoped to the studio-outputs bucket/prefix only |
| Downloads (customers) | Signed, expiring R2 URLs only — never public bucket links |

This is deliberately the simplest thing that works while Studio is admin/editor-only. **When/if public Studio access ships** (see `docs/PRD.md` §3), this needs to be replaced with real per-user auth + rate limiting + likely a credits/billing system — flagging now so it's not a surprise later, but not building it now.

## 5. Data Model (additions)

Existing tables carry over unchanged (`users`, `products`, `product_versions`, `product_previews`, `orders`, `order_items`, `licenses`/`downloads`, `coupons`, `reviews`, `feedback_tickets`). Additions for Studio traceability:

- `product_versions.source` — `'manual' | 'studio_generated'`
- `product_versions.studio_job_id` — nullable reference, for traceability back to which generation run produced this file (provider/model used, extracted BOW metadata) — useful once you're debugging "why does this lesson plan look off."

Studio's own job/run bookkeeping (status, timestamps, which provider/model, error messages) stays **inside `studio`** (in-memory or a lightweight local store) rather than in the shared Postgres — it only hands `api` the final, approved-for-review result. Keeps `api`'s schema from absorbing internal pipeline noise.

