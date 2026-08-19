# Workflow: BOW Update Monitor

**Status:** specified — ready for implementation
**Date:** 2026-08-19

## Loop

Watch the DepEd Budget of Work (BOW) sources for changes. On a change, import the new PDF into studio and hand the affected entries to the `material-pipeline` workflow. Runs daily. It detects, imports, and hands off — it never generates, checks, or publishes itself. No AI, no checkpoint of its own (except failure alerts).

## Trigger

**Schedule:** daily at 06:00 local time (configurable). An event-triggered design was considered and rejected: DepEd publishes on no schedule, and polling is the only reliable signal.

## Roles

- **Workflow** — polls, hashes, compares, imports.
- **Editor** — receives the result indirectly via the pipeline checkpoint the next time they open admin.

## Scope

- Uses the durable BOW identity from ADR-0007: SHA-256 content hash of the source PDF, recorded in the api-owned `bow_documents` table. No semantic comparison — a different file always gets a different hash, an identical one always matches.
- Poll source list is configurable. Initial source: the single BOW page the editor checks today.

## Steps

1. **Fetch.** Download the current BOW PDF(s) from each configured source URL.
2. **Hash.** Compute SHA-256 of each downloaded PDF.
3. **Compare.** Look up the stored record via `GET /internal/bow-documents` for that grade level / learning area / school year (ADR-0007).
   - Hash matches the stored one → no change → done. No-op.
   - Hash differs, or no record exists → the BOW changed or is new → proceed.
4. **Import.** Place the PDF into studio (the `material-pipeline` trigger). Studio computes the hash, extracts (reusing cache on the same hash), and records via `POST /internal/bow-documents` (ADR-0007).
5. **Hand off.** The pipeline regenerates the affected entries (those whose competencies changed) and opens its checkpoint per the `material-pipeline` spec.
6. **Done** when the import is recorded and handed off. Publishing still requires the editor's approval in the pipeline checkpoint.

## Error handling

- Fetch failure (site unreachable, structure changed) → log via `@eduksource/logger`, post an alert card in the admin checkpoint, retry on the next daily run. Never guess or fabricate a change.
- Import/persistence failure → log, alert via admin, retry next run. Safe to retry (hash-based idempotency).

## Config

- Source URL list (start: one DepEd BOW page).
- Poll time (default 06:00 local).
- `school_year` for the import (required by ADR-0007 — must be supplied at upload time; the editor sets it once per school year).

## References

- ADR-0007 (BOW extraction durability + content hash, `bow_documents`), ADR-0003 (api sole DB owner), ADR-0001 (studio runtime).
- `apps/studio` extraction routes + cache (existing).
- `workflows/material-pipeline.md` (handoff target).