# BOW Parsing Context — Parked (2026-08-22)

*Parked design record — not built.* The isolated BOW PDF parsing service design: Node on Fly.io (`apps/extraction`), wrapping `docling.rs` behind gRPC, with health-check-driven supervision and model-cache baked into its image. Studio would have been its only caller (ADR-0011), but `docling.rs` failed high-fidelity table structure (parked Q12/Q13). Folder stays `apps/extraction` (role, not library — ADR-0002 discipline); domain name is **BOW Parsing** (Q2=c) to avoid overloading Studio's **Extraction** term. Keep as record for future library swap.

## Language

**BOW Parsing**:
The bounded context that parses a BOW PDF to markdown. Owns the gRPC wire surface and model caching; does not own the normalized-text hash or the durable record.
_Avoid_: extraction, docling, parsing service

**Extraction Result**:
The wire type returned by BOW Parsing to Studio: `markdown` + `warnings` + `status` (`SUCCESS`/`PARTIAL`/`FAILURE`). Studio derives `Extraction identity` from `markdown` and structures objectives JSON from it (Q3).
_Avoid_: extraction, BOW Document, parse result

**Header / PdfChunk**:
The client-streaming request framing for `ExtractBow`: first message is `Header` (`filename`, `total_bytes`, `grade_level`, `learning_area`, `school_year` — Q4), remaining messages are `PdfChunk` (`bytes data`), stream EOF = end (no `is_last` sentinel).
_Avoid_: chunk header, metadata chunk

**Health**:
Two surfaces: gRPC `HealthCheck` (`healthy` + `models_loaded`) for Studio's circuit breaker, and HTTP `GET /healthz` for Fly.io supervisor (200 only when `models_loaded:true`, else 503 — Q4).
_Avoid_: healthz, readiness probe

**Circuit breaker** *(owned by Studio, observes BOW Parsing)*:
Stateful breaker in Studio (`opossum`, Q5) — `closed`/`open`/`half_open` — counts only transport errors + `FAILURE` (not `PARTIAL`); `PARTIAL` surfaces `warnings` in admin checkpoint, `FAILURE` falls back to Studio's `unpdf` path; state exposed on Studio `GET /health/extraction` (Q5/Q11).
_Avoid_: retry, fallback (fallback is the *action* on open/failure, breaker is the *policy*)

**Docling.rs**:
The underlying Rust library (`docling.rs`) with ONNX runtime, not a domain term. Never use as context/service name.
_Avoid_: docling, docling service
