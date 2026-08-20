# Context Map

## Contexts

- [API](./apps/api/CONTEXT.md): marketplace backend — catalog, cart, orders, checkout, licenses, coupons, reviews, feedback, BOW documents
- `apps/studio`: AI generation pipeline (Node, admin/editor-only) — context file not written yet
- `apps/store`, `apps/admin`, `apps/docs`, `apps/search`: planned or early-stage — context files not written yet
- `packages/db`: shared Drizzle schema, owned by `api`

## Relationships

- **Studio → API**: HTTP on internal routes (`/internal/*`), internal-service token. Studio never touches Postgres directly (ADR-0003).
- **Search → API**: API publishes catalog domain events (RabbitMQ, ADR-0009); Search serves queries via gRPC routed through API.
- **Store/Admin → API**: BetterAuth session on public/admin routes.
