# ADR-0003: Studio Does Not Write to Postgres Directly

**Status:** Accepted
**Date:** 2026-08-14

## Context

`studio` generates draft products (lesson plan, deck, doc, exam) from a BOW PDF and needs those to eventually show up as real product records that `admin` can review and `store` can eventually sell. There are two ways to get generated output into the product catalog: give `studio` its own Postgres connection via `packages/db`, or have it hand results to `api` and let `api` do the write.

This matters more than it might look like at prototype scale: every downstream feature — checkout, licensing, re-download access, refunds — depends on `products`/`product_versions` being correct and consistent. `studio` is also the newest, least battle-tested part of the system (it's an AI pipeline, not CRUD), and it already lives on a separate runtime and deploy cadence from the rest of the platform (ADR-0001). Giving it direct write access to the same schema `api` depends on means two independently-deployed services can write to commercial data with no shared transaction boundary or coordination.

## Decision

`studio` uploads generated files directly to R2 (S3-compatible API), then calls `api`'s internal endpoint (`POST /internal/products` or similar) with the resulting R2 object keys and generation metadata. `api` performs the actual Postgres write and remains the sole owner of `packages/db`. `studio` never imports `packages/db` and never holds Postgres credentials.

## Alternatives Considered

- **Give `studio` direct access to `packages/db`** — rejected. Two independently-deployed services writing to the same schema without a shared transaction boundary is exactly the kind of thing that produces hard-to-debug data integrity issues, and it hands more attack surface (DB credentials) to the less mature, AI-driven part of the system.
- **Fully async, event/queue-based decoupling** (studio publishes an event, something else consumes it and writes to Postgres) — deferred, not rejected. This is architecturally cleaner for scale but is unnecessary complexity while generation is still synchronous and low-frequency (see `docs/architecture.md` §2.3). Revisit if/when the job-based async flow is built.

## Consequences

**Gets easier:**
- `api` stays the single, well-understood gatekeeper for anything that affects what a customer can buy or download — one place to enforce validation, auditing, and business rules.
- `studio` can misbehave (bad output, crash mid-pipeline, bug in a new AI-generated feature) without any risk of directly corrupting product/order data.

**Gets harder / new obligations:**
- One extra network hop (`studio` → `api`) after generation completes, plus an internal-only endpoint on `api` that needs its own service-to-service auth (see `docs/architecture.md` §4).
- Traceability from a product back to the studio run that generated it depends on `product_versions.source` and `product_versions.studio_job_id` being populated correctly on every call — this is now a contract between the two services, not just an implementation detail.
