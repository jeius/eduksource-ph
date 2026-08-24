# ADR-0011: Extraction Service as a Second Deliberate Microservices Learning Vehicle

**Status:** Parked — not built (2026-08-22) — design accepted, build deferred after spike failure. See § Parked note.
**Date:** 2026-08-20
**Parked:** 2026-08-22 — `docling.rs` failed high-fidelity BOW table structure test (rows/columns merged/lost, not just styling); `unpdf`+`pdfjs-dist` stays primary. Design kept as record; revisit only with a different library spike per `docs/specs/2026-08-20-extraction-service-design.md` §8.

## Context

`docling.rs` is a strong candidate to replace `unpdf`/`pdfjs-dist` for BOW extraction (see `docs/tech-stack.md`, pending spike), but it's a native addon that statically links the ONNX runtime. Native code doing CPU-heavy inference can crash the whole host process in ways a thrown JS error can't — a segfault inside the addon risks taking down `studio`'s entire process, not just the extraction request in flight.

Separately, there's an explicit desire to get more real microservices reps — specifically named as "I want the service-extraction reps," not a claim that Studio's current load requires this. That framing matters: the same instinct applied to `Order`/`Inventory`/`Notification` was rejected (no ADR — see the conversation predating ADR-0009) because splitting payment-critical logic for practice reasons risks real customer trust. Extraction doesn't carry that risk — it feeds Studio's internal draft-generation pipeline, an editor reviews everything before anything is sold, and a fallback path (`unpdf`/`pdfjs-dist`) already exists and keeps working regardless of this service's state. Same risk shape as `search` (ADR-0009), not `Order`/`Checkout`.

The remaining question is whether a full separate service is *justified* even at low risk, versus a cheaper fix — a `worker_threads`/child-process boundary inside `studio` addresses the crash-isolation risk directly without new infrastructure. That cheaper option was considered and explicitly not chosen, because the goal here is genuinely the reps, and a second service exercises patterns the in-process fix and `search` (ADR-0009) don't: streaming RPC (a PDF is a large payload, not a quick query), a circuit breaker (distinct from `search`'s per-request fallback), and health-check-driven process supervision.

## Decision

Build **`apps/extraction`** — not `apps/docling`, matching the naming discipline from ADR-0002 (name the boundary after its role, not the library inside it, so swapping the library later doesn't imply renaming the service). Node, hosted on Fly.io alongside `studio`/`search`.

- **IPC: gRPC with client-streaming upload**, not a single unary call — a PDF is a large payload where streaming the upload (and optionally streaming progress back) is a genuinely different pattern from `search`'s quick unary query/response.
- **Resilience: a circuit breaker in `studio`'s calling code**, not just a per-request fallback. After N consecutive failures, `studio` stops sending requests to `extraction` and falls back immediately for a cooldown window, rather than retrying against a known-bad instance on every call. This is a different resilience pattern from `search`'s "on error, use Postgres full-text" (ADR-0009) — reactive-per-request there, stateful-and-proactive here.
- **Health checks** — a `/healthz` endpoint Fly.io's supervisor uses for restart decisions, a concrete mechanism rather than an assumed property.
- **Fallback is unconditional and unchanged:** on circuit-open or extraction failure, `studio` uses the existing `unpdf`/`pdfjs-dist`/vision-fallback pipeline. Nothing about the current pipeline is removed — this is additive, which keeps the risk of trying it low.
- **Auth:** the existing internal-service-token pattern (`studio → extraction`), no new mechanism.
- **Model caching:** `docling.rs`'s model-cache/volume-vs-baked-image decision (see prior design discussion) lives entirely inside `extraction`'s own deployment, isolated from `studio`'s image — a side benefit of the split, not the reason for it.

## Alternatives Considered

- **`worker_threads`/child-process isolation inside `studio`** — the actual minimum fix for the crash-isolation risk on its own. Not chosen as the primary approach here specifically because the stated goal is the learning reps, not just risk mitigation; this remains a legitimate, cheaper alternative if the reps goal is ever deprioritized.
- **Fold extraction responsibilities into `search`** — rejected. Would muddy `search`'s clean, single-purpose boundary (indexing) with an unrelated concern, and the two have no natural reason to share a deployment.
- **Full scaling-group / concurrent-load-oriented design** — deferred. No evidence Studio's actual usage justifies scaling infrastructure; revisit only if real concurrent load appears.

## Consequences

**Gets easier:**

- Native-addon crash risk is contained to `extraction`'s process, not `studio`'s.
- Genuinely new patterns get exercised beyond what `search` already covered: streaming RPC, a stateful circuit breaker, health-check-driven supervision.
- `studio`'s own deploy image stays lean — it doesn't need to carry `docling.rs`'s large ONNX-linked addon or its model cache.
- Fully additive and low-risk to try: the existing fallback pipeline is untouched, so a failed experiment here doesn't regress anything.

**Gets harder / new obligations:**

- **This is the fourth independently-deployed, independently-hosted service** (`studio`, `search`, now `extraction`, alongside the Workers-based platform apps). ADR-0009 already flagged the third service's solo context-switching cost as a real consequence, not a hypothetical one — this makes it worse, and that's worth stating plainly here rather than only discovering it later. Same candor `docling/plan.md` §1 already applies to scoping SDLC ceremony down for solo use.
- Circuit-breaker parameters (failure threshold, cooldown duration) are new tunables that need real-world calibration against actual failure behavior, not just picked theoretically.
- The model-cache/volume-vs-baked-image decision still needs solving concretely for `extraction`'s deployment — carried over unresolved from prior design discussion, not settled by this ADR.
- `docling.rs`'s "experimental" project maturity (noted in its own docs) is unaffected by where it's hosted — isolating it contains the blast radius of a crash, it doesn't make the underlying library more mature.
- Explicit scope discipline needed, same note as ADR-0009: this decision is justified partly by wanting the reps, not purely by a load or reliability need that's actually been observed. Worth being honest about that mix rather than retroactively justifying it as pure necessity.

**Parked note (2026-08-22):** Spike verified `docling.rs` can PDF→markdown but fails BOW high-fidelity tables structurally (Q12). Per spec §8 gate and Q13 (a), service not built; `studio` stays on `unpdf`/`pdfjs-dist`+vision with no gRPC/circuit/baked-cache. Keep `apps/extraction/CONTEXT.md` and spec as parked design record for future library swap (Q13 b). Update `docs/architecture.md`, `docs/tech-stack.md`, `docs/plan.md` Phase 10 accordingly — BOW Parsing marked parked, `search` remains the sole microservices vehicle for now.

**See also:** `docs/specs/2026-08-20-extraction-service-design.md` (now Parked) for the streaming contract, circuit-breaker design, and model-caching decision this ADR summarized.
