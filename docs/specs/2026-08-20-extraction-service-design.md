# `apps/extraction` — Service Design

**Status:** Parked — not built (2026-08-22). Design record kept; `docling.rs` spike failed high-fidelity BOW tables (structure loss), so `unpdf`/`pdfjs-dist` stays primary per ADR-0011 parked note. Do not implement without a new library spike.
**Depends on:** ADR-0011 (now Parked), the `docling.rs` evaluation spike (failed — see §8), ADR-0002 (internal-service-token auth pattern, naming discipline).
**Not depended on by anything** — `studio`'s existing `unpdf`/`pdfjs-dist` pipeline is the primary path; this spec is parked.

---

## 1. Goal

Wrap `docling.rs` behind a dedicated, crash-isolated service that `studio` calls for BOW extraction, with a real fallback path if it's unavailable. Secondary goal (the actual motivation, per ADR-0011): exercise streaming RPC, a circuit breaker, and health-check-driven supervision — patterns `search` (ADR-0009) didn't cover.

## 2. Service shape

- **Name:** `apps/extraction` (tech address). Domain name is **BOW Parsing** (Q2=c) — see `apps/extraction/CONTEXT.md`. Not `apps/docling` — if the underlying library ever changes, the service boundary shouldn't need renaming (ADR-0002 discipline, ADR-0011).
- **Runtime:** Node, Fly.io, same family as `studio`/`search` (scale-to-zero, auto-stop machines).
- **Public surface:** none. Only `studio` calls it, over per-boundary internal-service tokens — `STUDIO_TOKEN` (admin→studio) and `EXTRACTION_SERVICE_TOKEN` (studio→extraction) distinct values, same `Bearer` validation (Q9).

## 3. IPC contract: client-streaming gRPC

A PDF upload is a large, potentially multi-megabyte payload — a poor fit for a single unary gRPC call (message size limits, no progress visibility, all-or-nothing failure). Client-streaming lets `studio` send the file in chunks and get a single response back once conversion completes. Header-first framing (Q4) wires ADR-0008 safety-net fields through without a second round-trip and uses stream EOF as end-of-file (no `is_last` sentinel — Q8):

```proto
// extraction.proto
syntax = "proto3";

service ExtractionService {
  rpc ExtractBow(stream ExtractRequest) returns (ExtractionResult);
  rpc HealthCheck(HealthRequest) returns (HealthResponse);
}

message ExtractRequest {
  oneof payload {
    Header header = 1;
    PdfChunk chunk = 2;
  }
}

message Header {
  string filename = 1;
  uint64 total_bytes = 2;
  string grade_level = 3;     // for ADR-0008 near-duplicate check, supplied by admin or inferred
  string learning_area = 4;
  string school_year = 5;
}

message PdfChunk {
  bytes data = 1;
}

message ExtractionResult {
  string markdown = 1;
  repeated string warnings = 2;
  ExtractionStatus status = 3;
}

enum ExtractionStatus {
  SUCCESS = 0;
  PARTIAL = 1;     // some pages failed OCR/parsing; markdown may have gaps — studio surfaces warnings in admin checkpoint (Q3)
  FAILURE = 2;     // studio falls back to unpdf/pdfjs-dist+vision unconditionally
}

message HealthRequest {}
message HealthResponse {
  bool healthy = 1;
  bool models_loaded = 2;   // distinguishes "up but still loading models" from "ready" — Q4
}
```

**`normalized_text_for_hash` is not in `ExtractionResult` (Q3/Q8).** Studio derives `Extraction identity` (ADR-0008) from `markdown` inside Studio, so the caching contract has a single producer. BOW Parsing returns raw `markdown` only. Keep `docs/specs/2026-08-17-bow-extraction-caching-design.md` §2 in sync — it already says Studio normalizes and hashes after obtaining markdown from either BOW Parsing or fallback.

Auth on this channel: `EXTRACTION_SERVICE_TOKEN` as `authorization: Bearer <token>` in gRPC metadata (and `Authorization: Bearer` for the HTTP `/healthz` below — Q9). Distinct from `STUDIO_TOKEN`.

Node implementation: `@grpc/grpc-js` + `ts-proto` for generated types on both sides. This is unrelated to the Workers-native gRPC support mentioned in ADR-0009 (that's specifically for `api`, running on Workers, calling `search`) — `studio` and `extraction` are both plain Node processes, so a standard Node gRPC client/server pair is all that's needed here, no Workers-specific considerations apply. Add `gRPC` + `opossum` rows to `docs/tech-stack.md` (Q4/Q10).

## 4. Circuit breaker (lives in `studio`, not `extraction` — Q5)

State machine, per the standard circuit-breaker pattern:

| State | Behavior |
| --- | --- |
| **Closed** (normal) | Requests go to `extraction`. Each `FAILURE` or transport error increments a counter; `PARTIAL` does **not** (it returns `warnings`, not a failure — Q3/Q5). |
| **Open** | After N consecutive failures (starting point: **5** — needs real calibration, not a final number), stop calling `extraction` entirely for a cooldown window (starting point: **60s**). Every call during this window goes straight to the fallback pipeline, no network attempt. |
| **Half-open** | After the cooldown, allow one trial request through. Success → close the circuit. Failure → reopen, cooldown restarts. |

A small library (e.g. `opossum`, a well-known Node circuit-breaker package) is a reasonable starting point rather than hand-rolling the state machine — the value here is exercising the *pattern* in a real call path, not proving you can implement a state machine from scratch.

**Fallback on open or on `FAILURE`, unconditionally:** `studio` calls its existing `unpdf`/`pdfjs-dist` + vision-model-fallback pipeline. `PARTIAL` surfaces `warnings` in the admin checkpoint (whole-import checkpoint session per `workflows/material-pipeline.md`) and does not trigger fallback. No behavior change to the fallback path — `extraction` is purely additive on top of it.

**Observability:** breaker state exposed on Studio `GET /health/extraction` (dedicated endpoint, not `GET /health/providers` — Q5/Q11): `{ circuit: "closed"|"open"|"half_open", failures, next_attempt_at, extraction_healthy, models_loaded }` via `@eduksource/logger`.

## 5. Health checks (Q4)

Two surfaces, per Q4:

- **gRPC `HealthCheck` RPC** (`healthy` + `models_loaded`) — for Studio's circuit breaker and `GET /health/extraction` to report `extraction_healthy`/`models_loaded`.
- **HTTP `GET /healthz`** — for Fly.io supervisor. Thin handler that calls the same readiness check internally: 200 only when `models_loaded:true`, else 503. Fly config treats `models_loaded:false` as not-yet-ready, not unhealthy — cold-start loading is expected, not a restart signal. Token? No — Fly's check is unauthenticated liveness; Studio's breaker check is token-authenticated.

## 6. Model caching (inherited decision point, resolved here for this service specifically — Q6)

Per the earlier design discussion: `docling.rs`'s model cache defaults to `~/.cache/docling.rs`, overridable via `$DOCLING_RS_CACHE_DIR` (verify this against `docling-node`'s actual README before relying on it — still open, see §8).

**Recommendation for `extraction` specifically: bake models into the Docker image at build time**, not a Fly.io persistent volume. Reasoning specific to this service: `extraction` is a single-purpose worker with no other large dependencies competing for image size, it runs as a single machine in a single region today, and baking sidesteps Fly.io volumes' machine-pinning constraint entirely if `extraction` ever needs more than one instance later. If image size becomes a real problem (slow deploys, registry storage cost), revisit toward a volume — but don't start with the more complex option.

**Gate (Q6):** verify `DOCLING_RS_CACHE_DIR` before finalizing Dockerfile; measure baked image size — if >2GB or deploy >5 min, document fallback to volume in ADR Consequences and keep Dockerfile volume-ready (`ARG`).

## 7. What this deliberately does not do

- No retry-with-backoff *inside* `extraction` itself for transient failures — that's `studio`'s circuit breaker's job, keeping the retry/fallback logic in one place rather than duplicated on both sides of the call.
- No horizontal scaling / multiple `extraction` instances — single machine, matching Studio's actual (low) request volume. Revisit only with evidence, not anticipation.
- No attempt to make `docling.rs` more production-mature than it is — isolating it contains a crash, it doesn't fix upstream library maturity (ADR-0011).

## 8. Open items — resolved as parked (2026-08-22)

- **Verify `DOCLING_RS_CACHE_DIR` against `docling-node`'s actual documentation/source** — still unconfirmed for the Node bindings specifically, only checked against the Python-bindings docs for the shared Rust core. Closed as moot while parked; reopen if service revived.
- **Circuit-breaker thresholds (5 failures / 60s cooldown) are starting guesses**, not calibrated — closed as moot while parked.
- **The `docling.rs` evaluation spike — FAILED** (high-fidelity BOW table structure loss, verified 2026-08-22 via web/docs + table test). This spec assumed the spike would succeed; it didn't, so `apps/extraction` has no reason to be built on `docling.rs` regardless of how well-designed the service boundary is (Q13 a). Parked per ADR-0011; revisit only with a different library spike per Q13 (b). `unpdf`+`pdfjs-dist` verified via `artifactsDir` options research for continued use.
