# ADR-0004: Supabase as Temporary Database Host

**Status:** Accepted (temporary — explicitly flagged for revisit)
**Date:** 2026-08-14 *(decision predates this ADR — part of the original v1 project plan; documented retroactively)*

## Context

The project needed a managed Postgres instance to start building against without taking on database ops work at prototype stage. Supabase offers hosted Postgres with a generous free tier and fast setup, which unblocks development immediately. It was marked "temporary" in the plan from day one — the intent was never to treat this as a permanent infrastructure decision, just to not let database hosting choice block getting `api` and the schema built.

## Decision

Use Supabase-hosted Postgres now, accessed exclusively through Drizzle ORM (`packages/db`, owned by `api` — see ADR-0003). Drizzle is the abstraction layer that makes this swappable later: migrating means changing a connection string and running migrations against the new target, not rewriting data-access code, **provided Supabase-specific features (Supabase Auth, Supabase Storage, Supabase-specific RLS patterns) are avoided** — the project already uses BetterAuth and R2 instead, which keeps this clean.

## Alternatives Considered

- **Self-hosted Postgres (Fly.io/Railway) or a managed provider like Neon/RDS** — deferred, not rejected. These are reasonable long-term candidates but add ops overhead (backups, scaling, connection pooling config) not justified while the schema is still being designed and the product is pre-launch.

## Consequences

**Gets easier:**
- Zero-setup managed Postgres, free tier covers prototype-stage usage.
- Drizzle keeps the actual data-access code portable regardless of which Postgres host is behind it.

**Gets harder / new obligations:**
- Must actively avoid Supabase-specific features (Auth, Storage, RLS-as-primary-access-control) to keep the migration path clean — this needs to stay a discipline, not just a one-time note.
- **This decision must be revisited before scaling** — free-tier limits, connection pooling behavior under real load, and long-term cost need evaluation once the product has real usage. Don't let "temporary" quietly become permanent by default.
