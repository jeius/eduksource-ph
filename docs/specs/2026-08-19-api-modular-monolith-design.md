# `apps/api` — Modular Monolith Structure & Module Boundary Rules

**Status:** Accepted — implementation spec. Module-boundary rules are convention-level implementation detail, not ADR-level decisions; see `apps/api/CONTEXT.md` for the resolved vocabulary.
**Depends on:** `docs/architecture.md` (existing monorepo layout, ADR-0003's "api is sole DB gatekeeper" pattern), `docs/plan.md` §1 (API-first practice) and §2 Phase 10 (Search service — the event bus's real consumer), ADR-0007/0008 (BOW document records), ADR-0009 (search seam).
**Why now, not later:** Phase 2 is the first time `api` gets real route/business logic beyond a skeleton. This is the cheapest point in the project's life to lay out module boundaries — free today, real untangling work if retrofitted after Order/Checkout/Licenses code already exists tangled together.

---

## 1. Goal

`api` stays a single deployable Cloudflare Worker — no new services, no network calls introduced between its internal parts. What changes is *internal* organization: business logic is split into modules along the same bounded contexts identified when scoping a hypothetical future microservices split (Catalog, Cart, Orders, Checkout/Payment, Licenses, Coupons, Reviews, Feedback, BOW Documents), each with an enforced boundary today. If any of these ever do get extracted into their own service later, the module boundary is the seam — extraction becomes "move a folder and swap one file's implementation," not "trace through the codebase untangling which code talks to which tables."

**Auth is deliberately not a module.** It's cross-cutting middleware every module uses, not a domain that owns isolated business data — same reasoning discussed when this project's future-proofing was scoped out: extracting auth later means a mechanism change (session lookups → signed JWTs verified locally), not a module move.

---

## 2. Folder structure

```txt
apps/api/src/
  modules/
    catalog/
      routes.ts           # public: GET /products, GET /products/:id, filters
      internal-routes.ts  # service-token: POST /internal/products, GET /internal/products?full=true (search bootstrap, ADR-0009)
      service.ts          # business logic — the ONLY file allowed to touch this module's Drizzle tables
      port.ts             # exported interface other modules call through, e.g. getProductForCheckout({ productId })
      events.ts           # (Phase 10) domain events this module emits: ProductPublished, ProductArchived
      index.ts            # barrel — re-exports routes + port ONLY, never service internals
    cart/
      routes.ts
      service.ts
      port.ts
      index.ts
    orders/
      routes.ts
      service.ts
      port.ts
      events.ts           # (Phase 10) OrderPlaced, OrderCancelled
      index.ts
    checkout/
      routes.ts           # PayMongo/Stripe webhook handlers
      service.ts
      port.ts
      index.ts
    licenses/
      routes.ts
      service.ts
      port.ts             # e.g. grantLicense({ orderId, productVersionId })
      index.ts
    coupons/
      routes.ts
      service.ts
      port.ts             # validateCoupon({ code, cartTotal })
      index.ts
    reviews/
      routes.ts           # public product reviews (session-authed writes)
      service.ts
      index.ts
    feedback/
      routes.ts           # admin-guarded: private post-purchase buyer feedback
      service.ts
      index.ts
    bow-documents/
      internal-routes.ts  # service-token: GET/POST /internal/bow-documents (ADR-0007/0008)
      service.ts
      index.ts            # no port.ts — studio is its only consumer, via HTTP
  shared/
    events/
      bus.ts               # in-process event bus, built in Phase 10 — see §5
    middleware/
      auth.ts              # BetterAuth session/role check — cross-cutting, not a module
    errors.ts
  app.ts                   # mounts each module's routes.ts onto the Hono app
  index.ts                 # Workers entrypoint
```

Mirror the same split in `packages/db`, so a module's schema stays adjacent to the module boundary even at the data layer:

```txt
packages/db/src/schema/
  products.ts        # catalog module's tables (products, product_versions, product_previews)
  cart.ts
  orders.ts           # orders, order_items
  licenses.ts         # licenses/downloads
  coupons.ts
  reviews.ts
  feedback.ts
  users.ts             # auth-identity tables (users/sessions/accounts — BetterAuth's own) — written by auth middleware only, owned by no module
  bow-documents.ts     # ADR-0007/0008 — owned by the bow-documents module
  index.ts             # re-exports everything, this is what drizzle-kit points at for migrations
```

Splitting the schema files doesn't change how migrations work — `drizzle-kit` still generates against the combined `index.ts` export, one migration history, one database. This is purely an organizational mirror of the module boundary, not a functional change to the DB layer.

---

## 3. The actual rules

1. **A module's Drizzle tables are touched only by that module's own `service.ts`.** No route handler, and no other module, imports `products.ts`'s schema directly to run a query — if `checkout` needs product price, it calls `catalog`'s `port.ts`, not the `products` Drizzle table. **Exception:** auth-identity tables (`users`, sessions, accounts — BetterAuth's own) are written only by the auth middleware; modules never query them, and read identity through the request context alone.
2. **Cross-module communication goes through `port.ts`, never through a service file directly.** `port.ts` is the module's public contract — a small set of exported functions with a single input object and a single return value/promise, no shared mutable state, no passing a live DB transaction handle across the boundary. Shaped deliberately like an RPC call, even though it's an in-process function call today — that shape is what makes a later network-call swap a change to the port's *implementation*, not to every call site that uses it.
3. **`index.ts` is the only import path other modules are allowed to use.** It re-exports `routes.ts` (for `app.ts` to mount) and `port.ts` (for other modules to call) — never `service.ts` or the module's internal types. Enforce this with a lint rule (§4), not just convention — "just this once" cross-module imports are exactly what happens under deadline pressure without one.
4. **Cross-module Postgres joins in raw SQL are allowed, deliberately, when performance actually calls for it** — that's one of the real advantages of still being a monolith, and this spec isn't trying to pretend otherwise. The rule is about *application code* coupling (service files reaching into each other), not about banning joins at the database layer. If a query genuinely needs to join `orders` and `products`, write that query — just don't do it by importing another module's schema into your service file as a habit; keep it a deliberate, reviewed exception.
5. **Domain events are how a module announces something happened, without knowing who's listening.** `catalog` emits `ProductPublished`; `orders` emits `OrderPlaced`. Emitting modules don't know or care what (if anything) consumes these. The bus itself is a Phase 10 build — see §5.
6. **Two route kinds, two auth regimes.** `routes.ts` holds session-authed routes (store-public and admin-guarded — admin endpoints for feedback, order management, refunds live here). `internal-routes.ts` holds service-token routes for studio and (later) search only. Never mix the two auth regimes in one file.

---

## 4. Enforcement

Rules nobody's code can violate beat rules everyone has to remember. The repo's standard linter is Biome (no ESLint), so enforcement uses Biome's `noRestrictedImports` denylist globs in the existing `pnpm lint` step — no new pipeline, no second linter:

```txt
deny (anywhere):
  **/modules/*/service.ts     # cross-module service imports
  **/modules/*/internal-routes.ts  # internal routes are mounted only by app.ts
```

Be honest about the limits: Biome's rule is a denylist, not a whitelist, and it matches on import *source strings* — so the stronger half of rule 3 ("only `index.ts` from outside") and rule 1's "own tables only" are **convention, enforced by code review**, not by tooling. The denylist catches the worst offender (another module's `service.ts`) cheaply; the rest is review discipline.

---

## 5. The in-process event bus (Phase 10 seam)

The bus does not exist in Phase 2. It is a documented seam, built when the Search service lands (Phase 10, ADR-0009) — the first consumer with a real need for it. Until then, ports cover every in-process cross-module call, and `events.ts` files are not created (empty event files are dead code).

When built, it is a minimal typed emitter in `shared/events/bus.ts` — synchronous, in-memory, no broker:

```ts
type DomainEvent = { type: string; payload: unknown; occurredAt: string };
// modules call bus.publish(event); interested modules call bus.subscribe(eventType, handler)
```

Its shape is chosen so the catalog events ADR-0009 needs (`product.published`/`updated`/`archived`) fit it unchanged: when those events leave the process for RabbitMQ, the swap is inside `bus.ts`'s implementation (publish → broker, with graceful-degradation fallback per ADR-0009), not a rewrite of every module that calls `bus.publish()`. Built once, reused whether an event stays in-process or crosses a service boundary.

---

## 6. What this deliberately does NOT do

- **No new Postgres schemas or databases per module.** Still one Supabase instance, one Drizzle client, one migration history. Database-per-service is a real future step (see the microservices future-proofing discussion) — this spec doesn't take it, on purpose.
- **No network calls between modules.** Everything here is in-process, same request, same transaction where one's needed. This is optionality being kept cheap, not a commitment to ever actually split anything.
- **No event bus in Phase 2.** The bus is a Phase 10 seam (§5), not a Phase 2 deliverable.
- **Doesn't decide which modules (if any) get extracted later**, or when. That's a separate decision, driven by an actual scaling need showing up — not something this spec pre-answers.
- **Auth stays out of the module list**, per §1 — folding it in as if it were a peer of Orders/Catalog would misrepresent what kind of thing it actually is.

---

## 7. Connection to Phase 2's API-first work

`docs/plan.md` §2 Phase 2 already calls for an API-first pass — Zod schemas + OpenAPI-annotated stub routes for products, cart, and orders, ahead of full handler logic. That work should land directly inside this structure from the first commit: stub routes for products go in `modules/catalog/routes.ts`, cart in `modules/cart/routes.ts`, and so on. These aren't two separate future exercises to reconcile later — API-first scaffolding and module boundaries are the same work, done once, in the right shape from the start.
