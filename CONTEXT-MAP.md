# Context Map

## Contexts

- [API](./apps/api/CONTEXT.md): marketplace backend — catalog, cart, orders, checkout, licenses, coupons, reviews, feedback, BOW Documents
- [Studio](./apps/studio/CONTEXT.md): AI generation pipeline (Node, admin/editor-only) — extraction, provider registry, lesson plan, slide generation
- [BOW Parsing](./apps/extraction/CONTEXT.md): *Parked* — design for BOW PDF parsing via `docling.rs` (`apps/extraction`) produced markdown for Studio; parked 2026-08-22 after high-fidelity table failure — `unpdf`+`pdfjs-dist` stays primary (ADR-0011)
- `apps/store`, `apps/admin`, `apps/docs`, `apps/search`: planned — context files land when code lands (ADR-0010)
- `packages/db`: shared Drizzle schema, owned by `api` — CONTEXT.md lands when package lands
- `packages/config`, `packages/logger`: infra — no CONTEXT.md (no domain terms, ADR-0010)

## Relationships

- **Studio → API**: HTTP on internal routes (`/internal/*`), internal-service token. Studio never touches Postgres directly (ADR-0003).
- **Studio → BOW Parsing**: *Parked* — would have been gRPC client-streaming `ExtractBow` (`apps/extraction`), per-boundary token + circuit breaker; not built — Studio uses in-process `unpdf`/`pdfjs-dist`+vision directly (ADR-0011 parked 2026-08-22).
- **Search → API**: API publishes catalog domain events (RabbitMQ, ADR-0009); Search serves queries via gRPC routed through API.
- **Store/Admin → API**: BetterAuth session on public/admin routes.
