# EdukSource PH — Project Plan

An online shop for DepEd Budget-of-Work-aligned teaching materials (PPT, DOCX, PDF), built as a Turborepo monorepo.

> This file is the source of truth for architecture, scope, and roadmap. See `CLAUDE.md` for coding conventions and day-to-day working rules.

---

## 1. Overview

**Product:** A digital marketplace where the owner sells self-made teaching materials aligned with DepEd's Budget of Work (BOW). Customers browse by grade level / subject / quarter, preview samples, purchase, and download. An admin app manages catalog, orders, and support.

**Apps:**

- `store` — customer-facing storefront
- `admin` — internal dashboard for catalog/order/support management
- `api` — backend API, all business logic and DB access
- `docs` — internal + eventually public documentation

---

## 2. Tech Stack

| Layer                | Choice                                                     | Notes                                                                     |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Monorepo             | Turborepo + pnpm workspaces                                |                                                                           |
| Frontend framework   | Tanstack Start                                             | store, admin, docs                                                        |
| UI components        | shadcn-ui                                                  | shared `packages/ui`                                                      |
| API framework        | Hono                                                       | chosen over Fastify — built for edge runtimes, matches Workers deployment |
| Compute              | Cloudflare Workers                                         |                                                                           |
| File storage         | Cloudflare R2                                              | signed/expiring URLs for downloads, never public bucket links             |
| Background jobs      | Cloudflare Queues                                          | watermarking, preview generation, email sending, webhook processing       |
| Database             | Supabase (Postgres)                                        | temporary; migrate path TBD                                               |
| ORM                  | Drizzle                                                    |                                                                           |
| Validation           | Zod                                                        | shared schemas in `packages/schemas`, used client + server                |
| Auth                 | BetterAuth                                                 | shared session across store/admin/api                                     |
| Payments (primary)   | **PayMongo**                                               | GCash, Maya, GrabPay, cards — PH-first, PH-compliant receipts             |
| Payments (secondary) | Stripe                                                     | international buyers                                                      |
| Email                | Resend + react-email                                       | transactional templates                                                   |
| Domain               | NameCheap → Cloudflare DNS                                 |                                                                           |
| Bot/spam protection  | Cloudflare Turnstile                                       | checkout, signup, contact forms                                           |
| Error tracking       | Sentry                                                     | all apps                                                                  |
| Analytics            | PostHog or Plausible                                       | conversion funnel, cart abandonment                                       |
| Search               | Postgres full-text (Drizzle) → Meilisearch/Typesense later | upgrade only if catalog grows large                                       |
| Testing              | Vitest (unit/integration), Playwright (e2e)                | checkout flow is the priority e2e path                                    |
| Lint/format          | Biome                                                      |                                                                           |
| Package manager      | pnpm                                                       |                                                                           |

---

## 3. Monorepo Layout

```txt
apps/
  store/        # Tanstack Start — customer storefront
  admin/        # Tanstack Start — admin dashboard
  api/          # Hono on Cloudflare Workers
  docs/         # Tanstack Start or static docs site
packages/
  ui/           # shared shadcn-ui components
  db/           # drizzle schema + migrations
  auth/         # betterAuth config, shared across api/store/admin
  email/        # resend templates (react-email)
  schemas/      # shared zod schemas
  config/       # shared tsconfig, biome config
```

---

## 4. Core Features

### Storefront (customer-facing)

- Product catalog browsing with filters by **grade level, subject, quarter** (maps to DepEd BOW structure — key differentiator)
- Product preview (sample pages/slides) before purchase
- Bundles (e.g. "Whole Quarter Bundle," "Grade 6 Full Year")
- Cart (client-state, synced to DB for logged-in users)
- Wishlist / save for later
- Reviews & ratings
- Coupon/discount codes
- Checkout — guest option + account creation
- Order history / "My Purchases"
- Persistent re-download access, including access to updated file versions

### Admin app

- Product CRUD with draft/published/archived status
- File versioning (replace a file without breaking past buyers' access)
- Sales/revenue dashboard (daily/monthly, best sellers)
- Coupon management
- Refund handling (PayMongo/Stripe)
- Customer feedback/support queue
- Basic CMS for product descriptions/images

### Cross-cutting

- Signed, expiring R2 download URLs
- PDF watermarking (buyer email/order ID) run async via Queue
- Auto-generated low-res previews for PPTX/DOCX/PDF (LibreOffice headless or conversion API)
- Philippine Data Privacy Act (RA 10173) compliance — privacy policy, consent handling
- BIR-compliant receipts (deferred but flagged early)
- Explicit license terms (single-classroom vs. school-wide vs. resale use)
- SEO: sitemap, product metadata, structured data (targets searches like "DepEd Grade 3 Math Q1 BOW")

---

## 5. Data Model (initial sketch)

Core tables — details to be finalized in `packages/db`:

- `users`
- `products` (title, description, grade_level, subject, quarter, price, status, current_version_id)
- `product_versions` (file_key, created_at)
- `product_previews` (image keys)
- `orders`, `order_items`
- `licenses` / `downloads` (grants access per purchase, tracks download count/expiry if any)
- `coupons`
- `reviews`
- `feedback_tickets`

---

## 6. Roadmap

### Phase 1 — Foundation

- [ ] Scaffold Turborepo + pnpm workspaces, Biome, shared tsconfig
- [ ] Cloudflare setup: Workers, R2 bucket, Turnstile
- [ ] Supabase project + Drizzle schema (users, products, orders, order_items, licenses, coupons, reviews)

### Phase 2 — Auth & API skeleton

- [ ] BetterAuth wired into `api`, shared session across `store`/`admin`
- [ ] Hono API core routes scaffolded (products, cart, orders) with Zod validation on every input

### Phase 3 — Storefront core

- [ ] Product catalog browsing (list/detail, filters by grade/subject/quarter)
- [ ] Cart
- [ ] Product preview rendering

### Phase 4 — Checkout & payments

- [ ] PayMongo integration (primary: GCash/Maya/cards)
- [ ] Stripe integration (secondary: international)
- [ ] Order creation + webhook handling via Cloudflare Queue
- [ ] Post-purchase: signed R2 links, watermarking job trigger

### Phase 5 — Admin app

- [ ] Product CRUD, publish/draft workflow, versioning
- [ ] Order/sales dashboard
- [ ] Coupon management, refunds, feedback queue

### Phase 6 — Communication

- [ ] Resend + react-email templates: order confirmation, download-ready, receipt, admin notifications

### Phase 7 — Docs app

- [ ] Stand up docs app early; document API/schema as it's built, not after

### Phase 8 — Hardening & launch

- [ ] Vitest coverage for business logic (pricing, license generation)
- [ ] Playwright e2e for checkout flow
- [ ] Sentry across all apps
- [ ] SEO pass on store (sitemap, metadata, structured data)
- [ ] Privacy policy, terms of use, license terms drafted
- [ ] Deploy: Workers (api), Pages/Workers (store, admin, docs), R2 (assets), custom domain via NameCheap → Cloudflare DNS

---

## 7. Open Questions / Decisions Deferred

- Supabase is marked temporary — decide long-term DB hosting before scaling
- Search engine upgrade (Meilisearch/Typesense) — revisit once catalog size is known
- BIR receipt compliance — needs research into requirements for a PH online seller before launch
- Download/license limits — decide whether re-downloads are unlimited or capped, and license enforcement approach
