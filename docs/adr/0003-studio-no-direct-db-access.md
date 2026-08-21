# ADR-0003: Studio Has No Direct DB Access

> **Moved to `apps/studio/docs/adr/0003-studio-no-direct-db-access.md`.** This stub preserves bare-number lookup.

studio has no Postgres access; goes through api's internal endpoint (service token). Studio owns this decision; check before anything that looks like "just give studio a DB connection for convenience."
