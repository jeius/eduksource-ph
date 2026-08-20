# API Context

The EdukSource PH backend: one Cloudflare Worker that owns all Postgres writes and all business logic, organized internally into modules along bounded-context lines.

## Language

**Module**:
A bounded slice of the api worker — routes, service, port, events, barrel — one per bounded context (Catalog, Cart, Orders, Checkout, Licenses, Coupons, Reviews, Feedback, BOW Documents).
_Avoid_: Service, microservice, domain package

**Port**:
A module's public contract: exported functions, each with a single input object and a single return value, shaped like an RPC call. The only in-process path other modules may call.
_Avoid_: Interface, adapter, facade

**Domain event**:
An in-process announcement a module emits (e.g. `ProductPublished`, `OrderPlaced`) without knowing who listens. The event bus (`shared/events/`) is a documented seam, built when Search lands (ADR-0009), not before.
_Avoid_: Message, notification

**Internal route**:
An `/internal/*` endpoint protected by the internal-service token, used by studio and (later) search. Distinct from session-authed routes.
_Avoid_: Admin route, private endpoint

**Cart**:
A pre-purchase basket of catalog items.
_Avoid_: Basket, shopping cart

**Checkout**:
The payment flow: provider sessions (PayMongo/Stripe) and their webhooks.
_Avoid_: Payment module, billing

**Order**:
A placed order and its lifecycle after checkout succeeds.
_Avoid_: Purchase, transaction

**Review**:
A public product review shown on the store.
_Avoid_: Rating (ratings are part of a review), comment

**Feedback**:
Private post-purchase buyer feedback to the seller, admin-only.
_Avoid_: Review (do not conflate), complaint

**BOW Document**:
A durable extraction record for a Budget of Work PDF (ADR-0007/0008), owned by the BOW Documents module.
_Avoid_: Extraction record, BOW cache entry
