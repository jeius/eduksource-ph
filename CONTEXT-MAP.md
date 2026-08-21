# Context Map

## Contexts

- [API](./apps/api/CONTEXT.md): marketplace backend — catalog, cart, orders, checkout, licenses, coupons, reviews, feedback, BOW Documents
- [Studio](./apps/studio/CONTEXT.md): AI generation pipeline (Node, admin/editor-only) — extraction, provider registry, lesson plan, slide generation
- `apps/store`, `apps/admin`, `apps/docs`, `apps/search`: planned — context files land when code lands (ADR-0010)
- `packages/db`: shared Drizzle schema, owned by `api` — CONTEXT.md lands when package lands
- `packages/config`, `packages/logger`: infra — no CONTEXT.md (no domain terms, ADR-0010)

## Relationships

- **Studio → API**: HTTP on internal routes (`/internal/*`), internal-service token. Studio never touches Postgres directly (ADR-0003).
- **Search → API**: API publishes catalog domain events (RabbitMQ, ADR-0009); Search serves queries via gRPC routed through API.
- **Store/Admin → API**: BetterAuth session on public/admin routes.
