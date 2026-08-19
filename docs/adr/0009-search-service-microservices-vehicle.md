# ADR-0009: Search as the Microservices Vehicle — Not Order/Inventory/Notification

**Status:** Accepted
**Date:** 2026-08-18

## Context

There was a genuine desire to get real, hands-on microservices experience (IPC, message brokers, service boundaries) inside a project that actually ships, rather than a disposable side project — reasonable, since most of what makes microservices hard in practice (partial failures, eventual consistency, contract drift) is only really learned by building against real constraints. The first candidate considered was decomposing `api`'s checkout flow into `Order`, `Inventory`, and `Notification` services, deliberately mirroring a classic microservices teaching example.

That candidate doesn't fit this project's actual domain:

- **EdukSource PH sells digital downloads.** An `Inventory` service exists to solve stock-reservation race conditions for limited physical goods — a problem this business doesn't have. Building it anyway means solving a problem invented to match the shape of a tutorial, not one the product has.
- **`Order`, split out from `api`, is the highest-stakes possible place to practice a new distributed-transaction pattern for the first time.** A customer's payment reliably becoming a license and download access is a trust-critical invariant, not just a feature. A saga implemented incorrectly while still learning the pattern risks "customer paid, got nothing" — a business-trust failure, not a bug ticket.
- **`Notification` is already solved.** `docs/plan.md` already has Resend + react-email + Cloudflare Queues covering this (Phase 6) — a new broker-backed service here would be redundant with a Workers-native primitive already in the stack, not a new capability.

## Decision

Build a **Search service** (`apps/search`, Node, hosted like `studio`) as the deliberate vehicle for these patterns instead. This isn't inventing new scope — `docs/tech-stack.md` already lists "Postgres full-text → Meilisearch/Typesense later, upgrade only if catalog grows large" as planned, deferred work. Search becomes the thing that pulls that forward, chosen specifically because it has the right risk profile for learning on real infrastructure:

- **Owns a derived index, not authoritative data.** Meilisearch/Typesense is `search`'s dedicated datastore — genuine database-per-service — but it's a read-model copy of data that still lives authoritatively in `api`'s Postgres. If the index is lost, nothing is actually lost; a bootstrap re-pull from `api` (`GET /internal/products?full=true`) rebuilds it. No backup strategy needed the way an owned-data service would require, because "reindex" is disaster recovery here.
- **Async IPC via RabbitMQ** for catalog-change events (`product.published`/`updated`/`archived`) published by `api` — the first genuine cross-runtime message-broker boundary in the project (Cloudflare Queues can't reach a plain Node service on a different host, so this is a real, not simulated, need for a broker).
- **Sync IPC via gRPC** for `store`'s search queries, routed through `api`. Feasible as of August 3, 2026, when Cloudflare shipped inbound TCP + native gRPC support for Workers/Containers — a platform gap that would have blocked this design a few weeks earlier no longer applies.
- **Graceful degradation, not a single point of failure.** If `search`/RabbitMQ/Meilisearch is unreachable, `api` falls back to the Postgres full-text search already in the stack — degraded, not broken. This is the resilience lesson (watch a request survive a dependency going down) done for real, without gambling it on payment-critical logic.

## Alternatives Considered

- **`Order`/`Inventory`/`Notification` split, as originally proposed** — rejected for the domain-fit and payment-integrity reasons in Context. Kept as a separate, deliberately-throwaway learning exercise (a "microservices dojo," not part of this codebase) if the underlying patterns are still worth practicing in isolation from real stakes.
- **A `Recommendations` service** — considered as an alternative low-stakes candidate, not chosen. Search was preferred because it's already committed, deferred work in `docs/tech-stack.md`, not new scope invented for the sake of the exercise — a stronger justification for the time spent.
- **Kafka instead of RabbitMQ** — deferred, not rejected outright. RabbitMQ fits a single, moderate-throughput event stream (catalog changes) with room to grow; Kafka's real advantages (replay, high-throughput streaming, long retention) matter more if event volume or audit-replay needs grow later. Revisit if that happens — not a decision to over-provision for now.

## Consequences

**Gets easier:**

- Real reps on message-broker semantics, RPC, and graceful degradation, on infrastructure that actually ships — not a disposable exercise.
- `search`'s "no authoritative data" property means the hardest, highest-stakes part of distributed systems (data ownership, backup/recovery for data nothing else has a copy of) is deliberately *not* what's being practiced here — appropriately scoped to a first real attempt.
- Pulls forward work (`docs/tech-stack.md`'s deferred search upgrade) that was going to be needed eventually regardless.

**Gets harder / new obligations:**

- A third independently-deployed, independently-hosted service (`studio`, and now `search`) — genuine solo context-switching cost and additional infrastructure to monitor and pay for (Meilisearch/Typesense storage, RabbitMQ hosting — a managed tier like CloudAMQP is worth using rather than self-hosting a broker solo).
- New internal `api` surface: the bootstrap endpoint (`GET /internal/products?full=true`) and the event-publishing plumbing (`api → RabbitMQ` on catalog changes) — both need building, both need the same internal-service-token auth pattern already established for Studio.
- Explicit scope discipline required: this decision is partly justified by wanting the learning reps, not purely by business necessity — worth being honest about that mix rather than presenting it as purely a business-driven choice, consistent with how `docs/plan.md` §1 is already candid about scoping SDLC ceremony down for solo use.
- Does not change the future-proofing state of `Order`/`Checkout`/`Auth` — those remain unsplit, and nothing here makes splitting them easier or harder. That's a separate decision, to be made if an actual scaling need shows up, not a natural next step from this one.

**See also:** the modular-monolith design (`docs/specs/2026-08-19-api-modular-monolith-design.md`) for how `catalog`'s module boundary and the generic event-publishing utility are structured to support this integration without `search`-specific logic leaking into `api`'s core.

## Open items

- No dedicated design spec for `search` itself (event schema, gRPC contract, bootstrap-endpoint shape) exists yet — this ADR records the decision and shape at a high level; a full `docs/specs/` design doc is a prerequisite before Phase 10 implementation begins, not written yet.
- RabbitMQ hosting choice (managed vs. self-hosted) not yet resolved — flag alongside `studio`'s original Fly.io/Cloud Run/Render-style decision process in `docs/plan.md` §3.
