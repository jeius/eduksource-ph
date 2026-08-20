# Workflow: BOW Update Monitor

**Status:** specified — ready for implementation
**Date:** 2026-08-19

## Loop

Watch the DepEd Budget of Work (BOW) sources for changes. On a change, import the new PDF into studio and hand the affected entries to the `material-pipeline` workflow. Runs daily. It detects, imports, and hands off — it never generates, checks, or publishes itself. No AI, no checkpoint of its own (except failure alerts).

## Trigger

**Schedule:** daily at 06:00 local time (configurable). An event-triggered design was considered and rejected: DepEd publishes on no schedule, and polling is the only reliable signal.

## Roles

- **Workflow** — polls, hands PDFs to studio for identity, compares, imports.
- **Editor** — receives the result indirectly via the pipeline checkpoint the next time they open admin.

## Scope

- Uses the durable BOW identity from ADR-0007/0008: SHA-256 of *normalized extracted text* (not raw PDF bytes — two downloads of the same BOW routinely differ byte-level), recorded in the api-owned `bow_documents` table. Identity is computed by studio's cheap non-AI text extraction (`unpdf`/`pdfjs-dist`) — the monitor never duplicates normalization logic, it hands the PDF to studio and reads the verdict back.
- Poll source list is configurable. Initial source: the single BOW page the editor checks today.

## Steps

1. **Fetch.** Download the current BOW PDF(s) from each configured source URL.
2. **Identify.** Hand each PDF to studio, which extracts text cheaply (no AI), normalizes per ADR-0008 (strip repeated headers/footers, collapse whitespace, drop page-number tokens), and computes the identity hash.
3. **Compare** against the stored record (`GET /internal/bow-documents`, ADR-0007/0008).
   - Hash matches the stored one → no change → done. No-op. (A re-download of the same BOW matches, where raw-byte hashing would false-positive.)
   - Hash differs, or no record exists → proceed.
4. **Safety net** (only when the hash missed): does a record already exist for the same grade level / learning area / school year under a different hash? If yes, the monitor is autonomous — no editor is watching at 6am — so it raises an admin checkpoint card ("re-download detected: reuse existing extraction or import as new?") and stops. Never silently re-extract. The editor decides when they open admin.
5. **Import.** No safety-net match (or the editor chose "import as new"): studio runs full extraction and records via `POST /internal/bow-documents` (ADR-0007/0008).
6. **Hand off.** The pipeline regenerates the affected entries (those whose competencies changed) and opens its checkpoint per the `material-pipeline` spec.
7. **Done** when the import is recorded and handed off, or the reuse decision is queued. Publishing still requires the editor's approval in the pipeline checkpoint.

## Error handling

- Fetch failure (site unreachable, structure changed) → log via `@eduksource/logger`, post an alert card in the admin checkpoint, retry on the next daily run. Never guess or fabricate a change.
- Import/persistence failure → log, alert via admin, retry next run. Safe to retry (normalized-text-hash idempotency).

## Config

- Source URL list (start: one DepEd BOW page).
- Poll time (default 06:00 local).
- `school_year` for the import (required by ADR-0007 — must be supplied at upload time; the editor sets it once per school year).

## References

- ADR-0008 (BOW identity: normalized-text hash + catalog safety net), ADR-0007 (durability, `bow_documents`), ADR-0003 (api sole DB owner), ADR-0001 (studio runtime).
- `apps/studio` extraction routes + cache (existing).
- `workflows/material-pipeline.md` (handoff target).