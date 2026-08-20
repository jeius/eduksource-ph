# EdukSource PH — Development Plan

Source of truth for development approach, roadmap phases, and open risks. Scope lives in `docs/PRD.md`, architecture in `docs/architecture.md`, status in `docs/progress.md`.

---

## 1. Development Approach (SDLC)

You're solo, so full Scrum/ceremonies would just add overhead. What's actually useful from "how big tech does it," scoped down:

**Model: Milestone-driven iterative development ("solo Kanban")**

- **Board:** GitHub Projects, one board, columns `Backlog → In Progress → Review → Done`. Each roadmap phase (§2) becomes a milestone; each checklist item becomes a card.
- **Trunk-based development:** `main` always deployable. Short-lived branches per task, PR per branch even solo — gives you a review checkpoint, a rollback point, and a changelog for free. Squash-merge.
- **Definition of Done = Exit Criteria.** Keep this pattern for every phase below — a concrete, testable end state per phase.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.) → enables auto-generated CHANGELOGs later with zero extra effort.
- **API-first for `api`:** define the route surface as Zod schemas + `@hono/zod-openapi`-annotated stub handlers before writing real handler logic. `store`/`admin` can then build against the generated OpenAPI types and mocked responses (`@anatine/zod-mock` or `msw`) while backend logic gets filled in incrementally, route by route. The contract lives in the same Zod schema that defines the implementation's types, not a hand-maintained spec file — so it can't silently drift the way traditional API-first tooling often does. Applies to new route surfaces going forward (see Phase 2 below); don't retrofit routes that already have real logic just to match the ordering.
- **CI (GitHub Actions):** typecheck + lint (Biome) + unit tests (Vitest) on every PR. Playwright e2e (checkout flow, studio pipeline) gated before merging to `main`.
- **CD:** preview deployments per branch for `store`/`admin`/`docs` (Cloudflare Pages does this natively); a staging Workers environment for `api`; a staging instance for `studio` on whatever Node host you land on (`docs/architecture.md` §2.4). Promote to production via a tagged release.
- **Weekly self-check-in:** `docs/progress.md` — mainly so context isn't lost between sessions, since you're the only continuity the project has.

This gives you PR review discipline, CI safety nets, and a paper trail — without pretending you're a five-person team.

## 2. Roadmap

Two tracks that mostly run independently until Phase 5, where Studio's output starts flowing into real product records.

> **Workflow specs:** `workflows/*.md` are the source of truth for the three operational loops — `material-pipeline` (BOW → published products, checkpoint in admin), `bow-monitor` (daily DepEd change detection + import), `email-triage` (Gmail poll, auto-reply, admin checkpoint). Phases below implement them; don't let implementation drift from the loop specs.

### Phase 0 — Planning ✅

- [✅] This document set (PRD, architecture, tech-stack, plan)

### Phase 1 — Foundation

**Track A — Platform**

- [✅] Scaffold Turborepo + pnpm workspaces, Biome, shared tsconfig
- [ ] Cloudflare setup: Workers, R2 bucket, Turnstile
- [ ] Supabase project + Drizzle schema (users, products, orders, order_items, licenses, coupons, reviews)

**Track B — Studio** *(carried over from STUDIO_PLAN — already in progress)*

- [✅] Hono.js project skeleton (Node runtime)
- [✅] AI provider API key + test call
- [✅] PDF extraction route: parse a sample BOW PDF → structured objectives (JSON)
- [✅] In-memory extraction result cache (per-file hash) — avoids re-running the LLM on re-uploads
- [ ] Lesson plan generation route: prompt design + structured JSON output
- [ ] PPTX generation: lesson plan JSON → slides via `pptxgenjs` (basic template)
- [ ] DOCX generation: lesson plan JSON → Word doc via `docx` (npm)
- [ ] Summative/term test generation route: structured question/answer JSON
- [ ] Manual end-to-end test: one BOW PDF → all four outputs, reviewed by hand
- [✅] **New:** build the provider registry (`docs/architecture.md` §3) — even if only NIM is wired up first, structure it as swappable from day one so adding OpenRouter/Opencode later is a config change, not a refactor

**Exit criteria:** platform monorepo boots; a single BOW PDF can be run through the full Studio pipeline locally, producing a usable (if unpolished) lesson plan, deck, doc, and test.

### Phase 2 — Auth & API skeleton + Studio refinement

**Track A**

- [ ] BetterAuth wired into `api`, shared session across `store`/`admin`
- [ ] API-first pass on `api`'s core surface: Zod schemas + OpenAPI-annotated stub routes for products, cart, and orders (the full Phase 3/4 surface) — `store`/`admin` can start building against generated types and mocked responses immediately; real handler logic fills in incrementally after

**Track B**

- [ ] Improve PPTX/DOCX visual design (templates, EdukSource branding)
- [ ] Tune summative/term test quality (difficulty balance, answer key accuracy, variety)
- [ ] Internal service-token auth for `admin` → `studio` calls (`docs/architecture.md` §4)
- [ ] Error handling/retries around AI calls (rate limits, timeouts, cross-provider fallback per `docs/architecture.md` §3)
- [ ] Add job-based flow if generation time makes blocking requests impractical

**Exit criteria:** Studio output is consistently good enough for an editor to approve with minor edits, not rewrite from scratch. Auth is real, not a placeholder. `api`'s core surface has a stable, reviewable contract before its handlers are fully built out.

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
- [ ] `admin` UI: upload BOW PDF → trigger Studio job → review draft → approve/publish — **implement the checkpoint brief + approve/reject/manual-fix routing from `workflows/material-pipeline.md`** (whole-import checkpoint session, per-product rows, price override at publish)
- [ ] Studio → R2 direct upload + `api` `POST /internal/products` call (`docs/architecture.md` §2.3) wired end-to-end
- [ ] **BOW update monitor** per `workflows/bow-monitor.md`: daily 6am poll of DepEd source(s), SHA-256 hash-compare vs `bow_documents` (ADR-0007), import changed PDF into studio + hand affected entries to the pipeline
- [ ] Finalize Studio Node hosting choice (`docs/architecture.md` §2.4) and deploy
- [ ] **Revisit AI provider licensing terms** for whichever provider is primary at this point (`docs/architecture.md` §3)

**Exit criteria:** a real BOW PDF, uploaded by you as editor, produces a draft product that gets approved and appears (as draft/unpublished) in the admin catalog.

### Phase 6 — Communication (Track A)

- [ ] Resend + react-email templates: order confirmation, download-ready, receipt, admin notifications
- [ ] **Email triage** per `workflows/email-triage.md`: Gmail API OAuth poll (~5 min) → classify (FAQ/order question, support/refund, notification, spam) → auto-reply FAQs via Resend from verified domain, checkpoint the rest in admin with drafted replies

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

### Phase 10 — Search service (per ADR-0009)

`apps/search` (Node, hosted like `studio`) as the deliberate microservices vehicle: Meilisearch/Typesense read-model index, RabbitMQ for catalog events, gRPC for store queries routed through `api`. Graceful degradation to Postgres full-text when search is unreachable.

- [ ] Search design spec (`docs/specs/`): event schema, gRPC contract, bootstrap endpoint shape — prerequisite before implementation
- [ ] RabbitMQ hosting choice (managed tier, e.g. CloudAMQP, vs self-hosted)
- [ ] `api` event bus (`shared/events/bus.ts`, per the modular-monolith spec §5) + catalog `events.ts` — `product.published`/`updated`/`archived`
- [ ] `api` bootstrap endpoint: `GET /internal/products?full=true` (catalog module, service-token auth)
- [ ] `apps/search` service: index bootstrap, RabbitMQ consumer, gRPC query surface
- [ ] `store` search wired through `api` with Postgres-FTS fallback

**Exit criteria:** a published product appears in store search via Meilisearch/Typesense; killing the search service degrades store search to Postgres FTS, not broken.

## 3. Risks & Open Questions

| Risk / Question | Notes |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| AI provider licensing (per-provider "production use" terms) | Applies to whichever of NIM/OpenRouter/Opencode Go ends up primary once Studio output is actually sold — confirm before Phase 5 |
| Opencode Go API compatibility | Resolved 2026-08-16 — confirmed OpenAI-compatible; shared `openai` client works unmodified against all three providers |
| PDF extraction quality on scanned/irregular BOW formats | May need the vision-model fallback more than expected — validate early in Phase 1 |
| Generated content accuracy (curriculum alignment) | Human review by editor remains mandatory before anything is sold — not fire-and-forget |
| Studio Node hosting | Resolved: Fly.io (region `sin`, auto-stop scale-to-zero). Revisit if cost scales |
| Supabase marked temporary | Decide long-term DB hosting before scaling |
| Search engine upgrade (Meilisearch/Typesense) | Resolved 2026-08-18 — pulled forward as Phase 10 (ADR-0009), not a wait-and-see upgrade |
| BIR receipt compliance | Needs research before launch |
| Download/license limits | Decide whether re-downloads are unlimited or capped, and enforcement approach |

---

## Appendix A — Docs App Structure (Phase 7 detail)

Sketched ahead of time so Phase 7 is a build task, not a design task. Two kinds of content, handled differently:

### A.1 Content sources

| Content | Canonical location | How `docs` gets it |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `docs/PRD.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/plan.md`, `docs/progress.md`, `AGENTS.md` | repo `docs/` + root | prebuild script copies into `apps/docs/content/` — keeps the app self-contained for deployment while the repo files stay the single editable source |
| ADRs | `/docs/adr/*.md` | same prebuild copy step |
| API reference (`api`) | generated `openapi.json` from `@hono/zod-openapi` | fetched at build/runtime from the deployed `api` service |
| API reference (`studio`) | generated `openapi.json` from `@hono/zod-openapi` | fetched at build/runtime from the deployed `studio` service |
| Guides (e.g. "how the Studio pipeline works") | `apps/docs/content/guides/` | written directly in the docs app, since these are docs-specific, not shared elsewhere |

Don't fork docs/ADRs/plan into a second hand-maintained copy — the copy step is a build detail, not a second source of truth.

### A.2 Nav / route structure

```

apps/docs/
  src/
    routes/
      index.tsx              # landing + getting started
      architecture/
        index.tsx            # renders docs/architecture.md + docs/plan.md
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
