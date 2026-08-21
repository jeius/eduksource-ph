# ADR-0007: BOW Extractions Are Durable, API-Owned Records Keyed by Content Hash

**Status:** Accepted
**Date:** 2026-08-17

## Context

A BOW PDF for a given grade level and learning area is a stable document — it doesn't change week to week. Studio's original extraction design cached results only in memory, scoped to a single session (~60 min TTL). That helps an editor generating multiple weeks' worth of material in one sitting, but does nothing for the far more common case: the same editor returning days or weeks later to generate the next week's lesson plan from the *same* BOW. Under the session-only design, that return visit forces a full re-extraction — including any vision-model fallback calls for scanned pages — of a document Studio has already processed, purely because time passed between requests.

Fixing this needs an identity scheme for "is this the same document," a decision on where the extraction result lives long-term, and a decision on whether persisting it conflicts with the existing rule that Studio never writes to Postgres directly (ADR-0003).

## Decision

BOW extractions become durable records, identified by **content hash** (SHA-256 of the source PDF), not by semantic fields like grade level or learning area. Storage follows the same pattern already established for generated products: the extraction JSON and source PDF live in R2, a lightweight index row (`bow_documents`, owned by `api`) tracks the metadata — `content_hash`, `grade_level`, `learning_area`, `school_year` (required, not nullable — see Alternatives), R2 keys, and extraction provider/model.

Studio reads/writes this table only through `api`'s internal endpoints (`GET`/`POST /internal/bow-documents`), using the same internal-service-token auth already used for product creation — consistent with ADR-0003, no new auth mechanism needed. A two-tier cache sits in front: an in-memory session cache inside Studio (fast path within one sitting) backed by the durable `api`-owned record (the actual reuse win across sessions). Both tiers use the same key — the content hash — so `extractionId` in the extraction endpoint's response *is* the content hash, not a separate random identifier.

## Alternatives Considered

- **Keep the ephemeral-only design** — rejected. Doesn't solve the actual problem; the whole point is reuse across sessions separated by days or weeks, which a TTL-bound in-memory cache structurally cannot provide.
- **Key by `(gradeLevel, learningArea)` instead of content hash** — rejected. DepEd curricula get revised across school years, so the "same" grade/subject combination can legitimately be a different document over time; a semantic key would either wrongly conflate two different BOWs or require brittle extra logic to detect a change. Content hash gets this right for free — a genuinely different file always gets a different hash, an identical re-upload always hits cache, with no reliance on how consistently the model transcribes `gradeLevel`/`learningArea` text.
- **Store extraction JSON inline as a Postgres `jsonb` column** — rejected. A full BOW extraction (raw text plus structured document) is a large payload that doesn't belong bloating the primary transactional database. R2 for the bytes, a lightweight Postgres index row for lookup — same shape already used for product files.
- **Give Studio its own persistent store (e.g. local SQLite) instead of routing through `api`** — rejected. Would violate the single-DB-gatekeeper property from ADR-0003 for no real benefit, and forecloses a genuinely useful future feature: an admin UI letting an editor browse and reuse already-extracted BOWs instead of re-uploading, which only works if the record is queryable through `api`.

## Consequences

**Gets easier:**

- Real cost and latency savings on repeat generations against the same BOW — the extraction pipeline, including any vision-model fallback, runs at most once per unique document, not once per session.
- Sets up a natural future feature (admin browses/reuses existing `bow_documents` instead of re-uploading) without any schema rework, since the durable record already exists and is queryable.

**Gets harder / new obligations:**

- Every `/extract` call now makes an `api` round trip on a cache miss (and a fast one on a cache hit) — acceptable given Studio's low request volume, but a new dependency that didn't exist in the purely-ephemeral design.
- Two new internal `api` endpoints to build and maintain (`GET`/`POST /internal/bow-documents`), alongside the existing `/internal/products`.
- `school_year` must be supplied at upload time for the record to be valid — the admin upload flow needs a way to capture it, which isn't automatic just because this ADR exists. Flag as a Phase 1/2 implementation detail, not yet solved by this decision alone.
- Retention/cleanup for `bow_documents` records and their R2 blobs isn't defined yet (tracked in `PROJECT_PLAN.md` §12) — low-volume enough to defer, but not indefinitely.

**See also:** `docs/specs/bow-extraction-caching-spec.md` for the full design (two-tier cache mechanics, endpoint contracts, data model detail this ADR summarizes).
