# ADR-0002: Swappable AI Provider Registry for Studio

**Status:** Accepted
**Date:** 2026-08-14

## Context

The original Studio prototype was built against NVIDIA NIM as the sole AI inference provider. Since then, two things changed: NIM has proven unreliable at peak times, and there's now access to additional OpenAI-compatible-style providers (OpenRouter, Opencode Go) with different pricing that fluctuates — including discount windows worth taking advantage of opportunistically.

Hardcoding a single provider means every provider switch is a code change across every call site, and makes it impossible to react quickly to an outage or a pricing change. Given this is a solo project where the person building it wants to actively shop providers over time, the AI client needs to be a swap-in-config decision, not a refactor.

## Decision

Build an internal provider registry inside `apps/studio` (not a shared package — no other app calls AI providers yet):

- A config object mapping provider name → `{ baseURL, apiKey, models }`, with `models` keyed by task type (extraction, lesson plan, summative test, image).
- NIM and OpenRouter both expose OpenAI-compatible chat completion endpoints, so the standard `openai` npm client works against either by swapping `baseURL`/`apiKey` — no heavier SDK needed for those two.
- Active provider selected via env var (`AI_PROVIDER`), with per-task model overrides (`AI_MODEL_LESSON_PLAN`, etc.) so provider and model choice can vary independently per task.
- Fallback chains through every configured provider (one attempt each) on error or rate limit, so a NIM outage at peak doesn't require manually flipping a switch mid-incident.
- OpenRouter's own `models: [...]` fallback array is used for fallback *within* OpenRouter; the registry's fallback handles the *cross-provider* case (OpenRouter itself down → try NIM/Opencode).

Opencode Go's API is OpenAI chat-completions compatible (confirmed 2026-08-16) — the shared `openai` client works against it unmodified through the registry, no provider-specific adapter needed.

## Alternatives Considered

- **Keep NIM as the sole hardcoded provider** — rejected; this is the status quo being replaced, and doesn't serve the goal of shopping providers for cost/reliability.
- **Adopt a heavier abstraction (e.g. Vercel AI SDK)** — deferred, not rejected outright. NIM and OpenRouter's OpenAI-compatible endpoints mean a much simpler `openai`-client-plus-registry approach covers the current need. Revisit if streaming, tool-use, or a wider set of non-OpenAI-compatible providers make a heavier SDK worth the added dependency weight.
- **Promote this to a shared `packages/ai` package now** — rejected for now (YAGNI); only `studio` calls AI providers today. Promote if a second app needs AI access.

## Consequences

**Gets easier:**

- Switching primary provider, or reacting to a discount/outage, is an env var change.
- Per-task model tuning (cheap/fast model for extraction, stronger model for lesson planning) is independent of provider choice.
- Reliability improves without manual intervention during a provider outage.

**Gets harder / new obligations:**

- Opencode Go API compatibility is confirmed (2026-08-16) — it uses the shared `openai` client through the registry without an adapter.
- AI provider "production use" licensing terms need to be reviewed **per provider**, not just for NIM, before Studio output is sold — this must happen before Phase 5 of the roadmap and again any time the primary provider changes.
- Slightly more moving parts than a single hardcoded client — acceptable trade-off given the explicit goal of provider flexibility.
