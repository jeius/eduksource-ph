# EdukSource PH — Project Plan (v2)

An online shop for DepEd Budget-of-Work-aligned teaching materials (PPT, DOCX, PDF), with an AI-assisted internal production pipeline. Built as a Turborepo monorepo.

> **This file is the source of truth** for scope, architecture, and roadmap. Superseders v1 `PROJECT_PLAN.md` and `STUDIO_PLAN.md` — both are merged in here. See `AGENTS.md` for coding conventions and `/docs/adr/` for individual decision records.
>
> **Changelog**
>
> - v2 (this doc): merged Studio in as `apps/studio`, added SDLC model, formal architecture section, documentation practice, service-to-service auth design, swappable AI provider strategy.
> - v1: initial ecommerce plan (store/admin/api/docs) + separate Studio prototype plan.

---

## 1. Overview

**Product:** A digital marketplace where the owner sells self-made teaching materials aligned with DepEd's Budget of Work (BOW). Customers browse by grade level / subject / quarter, preview samples, purchase, and download. An admin app manages catalog, orders, and support. A separate internal **Studio** service uses AI to turn a BOW PDF into draft products (lesson plan, slide deck, DOCX, summative/term exam) for an editor to review before listing.

**Apps:**

| App      | Audience                          | Runtime               | Status         |
| -------- | ---------------------------------- | ---------------------- | -------------- |
| `store`  | Public customers                   | Cloudflare Workers/Pages | Planned        |
| `admin`  | Internal admin/editor              | Cloudflare Workers/Pages | Planned        |
| `api`    | Backend for store + admin          | Cloudflare Workers      | Planned        |
| `studio` | Internal admin/editor (via `admin`) | **Node** (separate host) | In progress    |
| `docs`   | Internal, later public             | Cloudflare Workers/Pages | Planned        |

**Working prototype goal:** all four base features functional end-to-end — public storefront, admin dashboard, API, and studio generating real draft products from a BOW PDF that an editor can approve and list.

**Explicitly not in the prototype:** public/self-serve access to Studio. That's a future feature, gated on demand (see §13).

---

## 2. Product Requirements Summary

### 2.1 Goals

- Sell DepEd BOW-aligned digital teaching materials to Filipino teachers, with local payment methods (GCash/Maya) as the primary checkout path.
- Cut the time to produce a sellable material (lesson plan → deck → doc → exam) using AI, with a human editor as the final gate before anything goes live.
- Ship a working, deployed prototype covering all four base features before investing in polish.

### 2.2 Non-goals (for the prototype)

- Public/self-serve material generation (Studio stays admin/editor-only).
- High-throughput or real-time generation — Studio is a low-frequency internal tool.
- Multi-tenant or white-label support.
- Full BIR receipt automation (flagged, not blocking).

### 2.3 Primary personas

| Persona | Needs |
| ------------------ | ---------------------------------------------------------------------- |
| Shopper (teacher) | Find materials by grade/subject/quarter, preview, pay via GCash/Maya, re-download later |
| Admin/Editor | Upload a BOW PDF, get AI-generated drafts, review/edit, publish, manage orders/coupons/refunds |
| You (owner/dev) | Ship, deploy cheaply, swap AI providers opportunistically, keep the system debuggable solo |

### 2.4 Key non-functional requirements

- **Cost control:** scale-to-zero everywhere possible; AI provider costs must be swappable, not locked in.
- **PH compliance:** Data Privacy Act (RA 10173) — privacy policy + consent handling; BIR-compliant receipts flagged for later.
- **Security:** signed/expiring download URLs only, never public bucket links; admin/editor-only access to Studio for now.
- **Solo-maintainable:** every non-obvious decision gets an ADR; nothing depends on tribal knowledge only you remember today.

---

## 3. Development Approach (SDLC)

You're solo, so full Scrum/ceremonies would just add overhead. What's actually useful from "how big tech does it," scoped down:

**Model: Milestone-driven iterative development ("solo Kanban")**

- **Board:** GitHub Projects, one board, columns `Backlog → In Progress → Review → Done`. Each roadmap phase (§11) becomes a milestone; each checklist item becomes a card.
- **Trunk-based development:** `main` always deployable. Short-lived branches per task, PR per branch even solo — gives you a review checkpoint, a rollback point, and a changelog for free. Squash-merge.
- **Definition of Done = Exit Criteria.** You were already doing this in the old STUDIO_PLAN ("a single BOW PDF can be run through the full pipeline locally...") — keep that pattern for every phase below. It's the right instinct.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.) → enables auto-generated CHANGELOGs later with zero extra effort.
- **CI (GitHub Actions):** typecheck + lint (Biome) + unit tests (Vitest) on every PR. Playwright e2e (checkout flow, studio pipeline) gated before merging to `main`.
- **CD:** preview deployments per branch for `store`/`admin`/`docs` (Cloudflare Pages does this natively); a staging Workers environment for `api`; a staging instance for `studio` on whatever Node host you land on (§6.4). Promote to production via a tagged release.
- **Weekly self-check-in:** a `PROGRESS.md` log or just closing out the milestone — mainly so context isn't lost between sessions, since you're the only continuity the project has.

This gives you PR review discipline, CI safety nets, and a paper trail — without pretending you're a five-person team.

---

## 4. Tech Stack

| Layer                 | Choice                                                       | Notes                                                                                     |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Monorepo               | Turborepo + pnpm workspaces                                   |                                                                                                |
| Frontend framework     | Tanstack Start                                                 | store, admin, docs                                                                            |
| UI components          | shadcn-ui                                                       | shared `packages/ui`                                                                          |
| API framework          | Hono                                                            | used by **both** `api` (Workers) and `studio` (Node) — same framework, two runtimes           |
| Compute (store/admin/api/docs) | Cloudflare Workers                                    |                                                                                                |
| Compute (studio)       | **Node**, separate host (Fly.io / Cloud Run / Render — TBD, §6.4) | Workers' 128MB memory cap + CPU limits are a poor fit for PDF/PPTX/DOCX assembly              |
| File storage           | Cloudflare R2                                                   | signed/expiring URLs only; `api` uses native R2 binding, `studio` uses R2's S3-compatible API |
| Background jobs        | Cloudflare Queues                                               | watermarking, preview generation, email sending, webhook processing (platform side)           |
| Database               | Supabase (Postgres)                                             | temporary; migrate path TBD                                                                    |
| ORM                    | Drizzle                                                         | lives in `packages/db`, **owned exclusively by `api`** — see §6.3                             |
| Validation              | Zod                                                             | shared schemas in `packages/schemas`, used client + server + by `studio`                      |
| Auth                   | BetterAuth                                                      | shared session across store/admin/api; `studio` uses a separate internal service-auth scheme, §8 |
| AI inference (studio)  | **Swappable**: NVIDIA NIM, OpenRouter, Opencode Go              | OpenAI-compatible clients behind one internal provider registry — see §7                       |
| PDF extraction (studio)| `pdf-parse` / `unpdf`, NIM/vision-model fallback for scanned PDFs |                                                                                              |
| PPTX generation         | `pptxgenjs`                                                     |                                                                                                |
| DOCX generation         | `docx` (npm)                                                    |                                                                                                |
| Payments (primary)     | **PayMongo**                                                    | GCash, Maya, GrabPay, cards — PH-first, PH-compliant receipts                                  |
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
| API docs               | `@hono/zod-openapi` → OpenAPI spec → rendered in `docs`          | new — generated from the same Zod schemas you're already writing, not hand-maintained          |

---

## 5. Monorepo Layout

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

**Note:** `studio` deliberately does **not** depend on `packages/db`. It talks to Postgres only indirectly, through `api`'s endpoints (§6.3). This keeps `api` as the single gatekeeper for product data, which matters once you have buyers whose access depends on that data being correct.

I'm intentionally *not* adding a shared `packages/ai` yet — only `studio` calls AI providers right now, so that logic lives inside `apps/studio`. Promote it to a shared package only if a second app needs it (e.g. if `admin` ever calls AI directly for something unrelated to Studio).

---

## 6. System Architecture

### 6.1 Context diagram

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
              (pdf-parse/   registry:      direct upload
               unpdf +      NIM /          of generated
               vision       OpenRouter /   files
               fallback)    Opencode Go
```

### 6.2 Why two runtimes

`api`, `store`, `admin`, `docs` all run on Cloudflare Workers — cheap, fast cold starts, tightly integrated with R2/Queues. `studio` cannot: PDF parsing, PPTX/DOCX assembly, and multi-step LLM calls need Node's memory/CPU headroom and native module support that Workers' 128MB/CPU-time limits don't give you. This was already the right call in the original Studio plan — it just needs to be documented as a first-class architectural decision, not a one-off exception. **→ ADR-0001** (recommended, see §10).

### 6.3 Studio ↔ API data flow (per your answer)

1. Editor uploads a BOW PDF in `admin` → `admin` calls `studio` with an internal service token (§8).
2. `studio` runs the pipeline: extract → lesson plan (AI) → PPTX/DOCX assembly → summative/term exam (AI).
3. `studio` uploads all output files **directly to R2** via the S3-compatible API (`@aws-sdk/client-s3` pointed at R2's endpoint, R2 access-key credentials — separate from `api`'s native Workers R2 binding).
4. `studio` returns (or the `admin` app receives) the resulting R2 object keys + generation metadata (which AI provider/model was used, extracted objectives, etc.).
5. `admin` calls `api`'s `POST /internal/products` (or similar) with those R2 keys to create a **draft** product record + `product_versions` row. `api` is the only thing that ever writes to Postgres.
6. Editor reviews the draft in `admin`, edits if needed, publishes — same flow as a manually-created product from here on. No special-casing downstream.

This keeps the "api is sole DB gatekeeper" property intact while letting `studio` do the heavy lifting close to the files it's generating, which is the right shape for what you described.

**Job model:** for the prototype, keep generation **synchronous** (submit → block → get result), matching your original Phase 1 plan. Move to async job + polling (Phase-2-in-STUDIO_PLAN territory) once real generation times make blocking requests impractical — no need to build queueing infrastructure before you know you need it.

### 6.4 Deployment target (resolved)

`studio` runs on **Fly.io** (`apps/studio/fly.toml`, region `sin`) — chosen from the Fly.io / Cloud Run / Render candidates for its auto-stop machines, which give scale-to-zero without idle bills. Revisit only if cost or cold-start behavior changes at Phase 5+ scale.

---

## 7. AI Provider Strategy (Studio)

Since you want to swap providers/models opportunistically (NIM being unreliable at peak, OpenRouter and Opencode Go already in hand), build this as a **provider registry**, not a hardcoded client:

```ts
// apps/studio/src/lib/ai/providers.ts
type TaskType = "extraction" | "lesson_plan" | "summative_test" | "image";

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

- NIM and OpenRouter both expose OpenAI-compatible chat completion endpoints, so the standard `openai` npm client works against either just by swapping `baseURL`/`apiKey` — no need for a heavier SDK. **Confirm Opencode Go's API shape** before assuming the same client works there; if it's not OpenAI-compatible, it needs its own thin adapter behind the same interface.
- Active provider selected via env var (`AI_PROVIDER=openrouter`), overridable per task (`AI_MODEL_LESSON_PLAN=...`) so you can e.g. run extraction on a cheap/fast model and lesson-plan generation on a stronger one, independent of which provider is "primary" this week.
- Add a simple fallback: if the primary provider errors or rate-limits, retry once against a configured secondary provider. This directly addresses "NIM is unreliable at peak times" without you having to manually flip a switch mid-outage.
- OpenRouter specifically supports a `models: [...]` fallback array in a single request — worth using as your OpenRouter-internal fallback layer, with your own registry handling the *cross-provider* fallback (OpenRouter down entirely → try NIM/Opencode).
- **Revisit licensing terms** per-provider before this is generating materials that are actually sold — this was already flagged for NIM in the original plan; extend that check to whichever provider ends up primary. **→ ADR-0002** (recommended).

---

## 8. Security & Access Control

| Boundary | Mechanism |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Shopper ↔ store ↔ api | BetterAuth session (shared cookie/session across store/api) |
| Admin/editor ↔ admin ↔ api | BetterAuth session, role-checked (admin/editor) on every mutating `api` route |
| `admin` ↔ `studio` | **Internal service token** (shared secret, env-configured) — `studio` is not exposed to the public internet; only `admin` (and later `api`, if the callback flow needs it) holds the token |
| `studio` ↔ R2 | R2 API token (Account ID + Access Key ID + Secret) scoped to the studio-outputs bucket/prefix only |
| Downloads (customers) | Signed, expiring R2 URLs only — never public bucket links |

This is deliberately the simplest thing that works while Studio is admin/editor-only. **When/if public Studio access ships (§13)**, this needs to be replaced with real per-user auth + rate limiting + likely a credits/billing system — flagging now so it's not a surprise later, but not building it now.

---

## 9. Data Model (additions)

Existing tables carry over unchanged (`users`, `products`, `product_versions`, `product_previews`, `orders`, `order_items`, `licenses`/`downloads`, `coupons`, `reviews`, `feedback_tickets`). Additions for Studio traceability:

- `product_versions.source` — `'manual' | 'studio_generated'`
- `product_versions.studio_job_id` — nullable reference, for traceability back to which generation run produced this file (provider/model used, extracted BOW metadata) — useful once you're debugging "why does this lesson plan look off."

Studio's own job/run bookkeeping (status, timestamps, which provider/model, error messages) stays **inside `studio`** (in-memory or a lightweight local store) rather than in the shared Postgres — it only hands `api` the final, approved-for-review result. Keeps `api`'s schema from absorbing internal pipeline noise.

---

## 10. Documentation Practices

Carried over from "how big tech does it," scoped to what's actually worth maintaining solo:

- **`PROJECT_PLAN.md`** (this file) — source of truth for scope/architecture/roadmap. Update it when a decision changes, not just when you remember to.
- **ADRs** in `/docs/adr/000X-title.md` — one per irreversible-ish decision (Context / Decision / Consequences, a few paragraphs each). Recommended first batch:
  - ADR-0001: Two-runtime split (Workers for platform, Node for Studio)
  - ADR-0002: Swappable AI provider registry + licensing review trigger
  - ADR-0003: Studio never writes to Postgres directly
  - (Existing ones worth backfilling: Supabase as temp DB, PayMongo as primary payment rail)
- **Repo `docs/` conventions** — `docs/adr/` holds ADRs; `docs/libraries/` per-library notes; `docs/models/` model notes; `docs/superpowers/` planning artifacts (plans/specs scratch, not a source of truth — gitignored). Keep `PROJECT_PLAN.md` and `AGENTS.md` the authoritative docs; don't fork content into these dirs.
- **`AGENTS.md`** — coding conventions, keep it current.
- **OpenAPI specs** for `api` and `studio`, generated from the Zod schemas you're already writing (`@hono/zod-openapi`) — rendered in `docs` rather than hand-written, so they can't silently go stale.
- **CHANGELOG.md** per deployable app — auto-generatable from Conventional Commits, near-zero maintenance cost given you're already doing PRs.

I can draft the ADR template and the first 1–2 ADRs as actual files if that'd be useful — just say the word.

---

## 11. Roadmap

Two tracks that mostly run independently until Phase 5, where Studio's output starts flowing into real product records.

### Phase 0 — Planning ✅

- [✅] This document

### Phase 1 — Foundation

**Track A — Platform**

- [✅] Scaffold Turborepo + pnpm workspaces, Biome, shared tsconfig
- [ ] Cloudflare setup: Workers, R2 bucket, Turnstile
- [ ] Supabase project + Drizzle schema (users, products, orders, order_items, licenses, coupons, reviews)

**Track B — Studio** *(carried over from STUDIO_PLAN — already in progress)*

- [✅] Hono.js project skeleton (Node runtime)
- [✅] AI provider API key + test call
- [✅] PDF extraction route: parse a sample BOW PDF → structured objectives (JSON)
- [ ] Lesson plan generation route: prompt design + structured JSON output
- [ ] PPTX generation: lesson plan JSON → slides via `pptxgenjs` (basic template)
- [ ] DOCX generation: lesson plan JSON → Word doc via `docx` (npm)
- [ ] Summative/term test generation route: structured question/answer JSON
- [ ] Manual end-to-end test: one BOW PDF → all four outputs, reviewed by hand
- [✅] **New:** build the provider registry (§7) — even if only NIM is wired up first, structure it as swappable from day one so adding OpenRouter/Opencode later is a config change, not a refactor

**Exit criteria:** platform monorepo boots; a single BOW PDF can be run through the full Studio pipeline locally, producing a usable (if unpolished) lesson plan, deck, doc, and test.

### Phase 2 — Auth & API skeleton + Studio refinement

**Track A**

- [ ] BetterAuth wired into `api`, shared session across `store`/`admin`
- [ ] Hono API core routes scaffolded (products, cart, orders) with Zod validation on every input

**Track B**

- [ ] Improve PPTX/DOCX visual design (templates, EdukSource branding)
- [ ] Tune summative/term test quality (difficulty balance, answer key accuracy, variety)
- [ ] Internal service-token auth for `admin` → `studio` calls (§8)
- [ ] Error handling/retries around AI calls (rate limits, timeouts, cross-provider fallback per §7)
- [ ] Add job-based flow if generation time makes blocking requests impractical

**Exit criteria:** Studio output is consistently good enough for an editor to approve with minor edits, not rewrite from scratch. Auth is real, not a placeholder.

### Phase 3 — Storefront core (Track A)

- [ ] Product catalog browsing (list/detail, filters by grade/subject/quarter)
- [ ] Cart
- [ ] Product preview rendering

### Phase 4 — Checkout & payments (Track A)

- [ ] PayMongo integration (primary: GCash/Maya/cards)
- [ ] Stripe integration (secondary: international)
- [ ] Order creation + webhook handling via Cloudflare Queue
- [ ] Post-purchase: signed R2 links, watermarking job trigger

### Phase 5 — Admin app + Studio integration (Tracks A + B converge)

- [ ] Product CRUD, publish/draft workflow, versioning
- [ ] Order/sales dashboard, coupon management, refunds, feedback queue
- [ ] `admin` UI: upload BOW PDF → trigger Studio job → review draft → approve/publish
- [ ] Studio → R2 direct upload + `api` `POST /internal/products` call (§6.3) wired end-to-end
- [ ] Finalize Studio Node hosting choice (§6.4) and deploy
- [ ] **Revisit AI provider licensing terms** for whichever provider is primary at this point (§7)

**Exit criteria:** a real BOW PDF, uploaded by you as editor, produces a draft product that gets approved and appears (as draft/unpublished) in the admin catalog.

### Phase 6 — Communication (Track A)

- [ ] Resend + react-email templates: order confirmation, download-ready, receipt, admin notifications

### Phase 7 — Docs app (Tracks A + B)

- [ ] Stand up `docs` app early
- [ ] OpenAPI specs for `api` and `studio` rendered in `docs`
- [ ] ADRs backfilled/linked from `docs`

### Phase 8 — Hardening & launch

- [ ] Vitest coverage for business logic (pricing, license generation)
- [ ] Playwright e2e for checkout flow **and** Studio pipeline
- [ ] Sentry across all apps, including `studio`
- [ ] SEO pass on store (sitemap, metadata, structured data)
- [ ] Privacy policy, terms of use, license terms drafted
- [ ] Studio: logging/monitoring for failed generations
- [ ] Deploy: Workers (store/admin/api/docs), Node host (studio), R2 (assets), domain via NameCheap → Cloudflare DNS

### Phase 9 — Future / deferred: Public Studio access

Only pursued if the project gains traction and users actually request self-serve generation. Requires its own mini-PRD when triggered: per-user auth on `studio`, rate limiting, a credits/billing model, abuse prevention, and almost certainly the async job flow rather than synchronous. Not scoped further now — deliberately.

---

## 12. Risks & Open Questions

| Risk / Question | Notes |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| AI provider licensing (per-provider "production use" terms) | Applies to whichever of NIM/OpenRouter/Opencode Go ends up primary once Studio output is actually sold — confirm before Phase 5 |
| Opencode Go API compatibility | Confirm it's OpenAI-compatible before assuming the shared client works unmodified |
| PDF extraction quality on scanned/irregular BOW formats | May need the vision-model fallback more than expected — validate early in Phase 1 |
| Generated content accuracy (curriculum alignment) | Human review by editor remains mandatory before anything is sold — not fire-and-forget |
| Studio Node hosting | Resolved: Fly.io (region `sin`, auto-stop scale-to-zero). Revisit if cost scales |
| Supabase marked temporary | Decide long-term DB hosting before scaling |
| Search engine upgrade (Meilisearch/Typesense) | Revisit once catalog size is known |
| BIR receipt compliance | Needs research before launch |
| Download/license limits | Decide whether re-downloads are unlimited or capped, and enforcement approach |

---

## 13. Explicitly Deferred / Not Doing Now

- **Public/self-serve Studio access from `store`** — planned feature, gated on user demand; see Phase 9.
- Cloudflare Workers deployment for `studio` — ruled out due to memory/CPU/native-module constraints.
- Separate Python microservice for PPTX/DOCX generation — no proven benefit at this scale; adds overhead.
- Self-hosted AI inference — not needed unless hosted endpoints become insufficient.
- Full BIR receipt automation — flagged, not blocking the prototype.
- Async job queue for Studio — start synchronous, add only when generation time demands it.

---

## Appendix A — Docs App Structure (Phase 7 detail)

Sketched ahead of time so Phase 7 is a build task, not a design task. Two kinds of content, handled differently:

### A.1 Content sources

| Content | Canonical location | How `docs` gets it |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `PROJECT_PLAN.md`, `AGENTS.md` | repo root | prebuild script copies into `apps/docs/content/` — keeps the app self-contained for deployment while root stays the single editable source |
| ADRs | `/docs/adr/*.md` | same prebuild copy step |
| API reference (`api`) | generated `openapi.json` from `@hono/zod-openapi` | fetched at build/runtime from the deployed `api` service |
| API reference (`studio`) | generated `openapi.json` from `@hono/zod-openapi` | fetched at build/runtime from the deployed `studio` service |
| Guides (e.g. "how the Studio pipeline works") | `apps/docs/content/guides/` | written directly in the docs app, since these are docs-specific, not shared elsewhere |

Don't fork ADRs/plan into a second hand-maintained copy — the copy step is a build detail, not a second source of truth.

### A.2 Nav / route structure

```
apps/docs/
  src/
    routes/
      index.tsx              # landing + getting started
      architecture/
        index.tsx            # renders PROJECT_PLAN.md
        adr.$slug.tsx         # renders one ADR per route
      api/
        index.tsx            # public api reference (Scalar) — store-facing endpoints only
        internal.tsx          # admin + studio api reference (Scalar) — gated, see A.3
      guides/
        $slug.tsx
  content/                  # populated by prebuild copy script, gitignored
```

### A.3 API reference rendering + a gating decision to make later

Use `@scalar/api-reference-react` (or Redoc as a fallback) to render the OpenAPI JSON — works as a plain React component, drops straight into a Tanstack Start route, no separate doc-generation toolchain needed.

One thing to decide **before** Phase 7, not during: `api` serves both public store endpoints and admin-only endpoints, and `studio`'s entire surface is admin/editor-only. If the whole `docs` app is public (per the original "internal + eventually public" framing), you don't want the admin/studio API surface documented in public — even read-only docs of internal routes is more reconnaissance than you want to hand out. Cleanest split: `/api` route is public and only reflects the store-facing subset of `api`'s OpenAPI spec; `/api/internal` (admin + studio reference) sits behind the same BetterAuth admin session check `admin` already uses. This is a two-line auth guard, not new infrastructure — just flagging it now so it doesn't get built as "everything public" by default and need unwinding later.

### A.4 What NOT to build in Phase 7

- No custom markdown/MDX pipeline — Tanstack Start's file/content handling plus a basic markdown-to-HTML step (e.g. `marked` or `mdx` if you want embedded components later) is enough; don't reach for a full docs framework.
- No search (Algolia/etc.) until the content volume actually justifies it — premature for a prototype-stage docs site.
