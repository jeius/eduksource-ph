# ADR-0001: Two-Runtime Split — Cloudflare Workers for Platform, Node for Studio

**Status:** Accepted
**Date:** 2026-08-14

## Context

The platform apps (`store`, `admin`, `api`, `docs`) run on Cloudflare Workers — cheap, fast cold starts, tight integration with R2 and Queues, and the right fit for request/response API work and server-rendered frontends.

`studio` is a different kind of workload: it parses PDFs, assembles PPTX and DOCX files with libraries that often rely on native modules, and makes multi-step LLM calls that can run long. Cloudflare Workers impose a 128MB memory cap and CPU-time limits per request that are a poor fit for document assembly at this scale, and Workers' runtime doesn't support the full Node API surface some of these libraries expect.

This was already the working assumption from the original Studio prototype plan; this ADR formalizes it as an architectural decision rather than a one-off exception, since it affects deployment, auth, and how `studio` talks to storage and the rest of the system.

## Decision

`studio` runs as a standalone Node service on a separate host (candidates: Fly.io, Cloud Run, Render — final choice deferred, see `PROJECT_PLAN.md` §6.4). It is not deployed to Cloudflare Workers. It uses the same API framework (Hono) as `api` for consistency, but a different runtime and deployment pipeline.

## Alternatives Considered

- **Run Studio on Cloudflare Workers, same as the rest of the platform** — rejected. Memory/CPU limits and native-module constraints make PDF/PPTX/DOCX generation impractical, especially as documents get longer or more image-heavy.
- **Separate Python microservice for document generation** — rejected. Python's document libraries aren't meaningfully better than the Node equivalents (`pptxgenjs`, `docx`) at this scale, and splitting into a second language adds deployment/network overhead with no proven quality or performance benefit.
- **Self-hosted GPU/inference alongside the document generation service** — rejected for now. Hosted AI provider endpoints (see ADR-0002) remove the need to manage inference infrastructure; revisit only if hosted endpoints become insufficient.

## Consequences

**Gets easier:**

- `studio` can use the full Node ecosystem without fighting Workers' constraints.
- Document generation libraries work as documented, no Workers-specific workarounds.

**Gets harder / new obligations:**

- Two deployment pipelines to maintain instead of one (Workers for platform, whatever host is chosen for Studio).
- `studio` can't use `api`'s native R2 Workers binding — it needs its own R2 access via the S3-compatible API (separate credentials, separate client library).
- `studio` isn't behind the same BetterAuth session flow as the rest of the platform (different domain/runtime), so it needs its own service-to-service auth scheme — see the internal service token approach in `PROJECT_PLAN.md` §8.
- One more environment to monitor, deploy, and pay for, even at scale-to-zero.
- The Node host choice itself is still open and needs to be settled before Phase 5 of the roadmap, when Studio starts writing real products.
