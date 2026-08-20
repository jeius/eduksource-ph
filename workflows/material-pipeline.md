# Workflow: Material Pipeline (BOW → Published Products)

**Status:** specified — ready for implementation
**Date:** 2026-08-19

## Loop

Take a Budget of Work (BOW) PDF and turn it into published store products: one bundle product per BOW entry (all artifact types together) plus one single product per artifact type (lesson plan, slides, exam, worksheet). Runs whenever a new BOW arrives. The human reviews once, late, via a decision-ready brief in the admin app. Everything before that is automated.

## Trigger

**Event:** a new BOW PDF appears in studio — either a manual upload by the editor or an import by the `bow-monitor` workflow. The arrival of the PDF starts a pipeline run.

## Roles

- **Workflow** — runs generation, checks, publishing.
- **Editor** (the user) — reviews once per import via the checkpoint; decides per product.

## Scope

- Studio is generation-only (ADR-0001, ADR-0002, ADR-0003): it extracts, generates, checks, uploads bytes to R2. All persistence goes through `api` internal endpoints.
- Admin app is the only review surface: checkpoint briefs for this workflow and for `email-triage` render there.
- Checkpoint pushes right: generation + the 3 checks complete before the editor is asked anything.

## Steps

1. **Identify.** PDF arrives in studio. Extract text cheaply (no AI: `unpdf`/`pdfjs-dist`), normalize per ADR-0008 (strip repeated header/footer lines, collapse whitespace, drop page-number tokens), hash — that hash is the identity. Look up `GET /internal/bow-documents` by it (ADR-0007/0008).
   - Hit → reuse the stored extraction (session cache first, then api record).
   - Miss → safety net: a record exists for the same grade level / learning area / school year under a different hash → raise a non-blocking admin card: "we already have an extraction for this grade/subject/year — reuse it or continue as new?" The pipeline proceeds as new; the editor can flip to reuse from the card.
   - Then run full extraction (vision-model fallback only when text extraction is thin, provider via registry per ADR-0002) → `POST /internal/bow-documents` (record + R2 blobs; `school_year` supplied at upload time per ADR-0007).
2. **Parse entries.** Split the extraction into BOW entries (grade level, learning area, quarter/week, learning competencies).
3. **Generate.** For each entry, generate the full artifact set: bundle artifacts + 4 singles (lesson plan, slides, exam, worksheet). Auto-generate a cover image from metadata (title, subject, grade). All AI calls go through the provider registry (ADR-0002).
4. **Check.** Run the 3 checks per product: (1) BOW competency alignment, (2) factual/content correctness, (3) formatting. Record pass/fail per check plus risk flags. Persist via `api` internal endpoints (same pattern as `/internal/products`).
5. **Checkpoint (the review).** When the whole import's generation completes, open a checkpoint session in the admin UI. The editor reviews in one sitting.
6. **Approve → publish.** For each approved product, `api` creates the store product: artifacts to R2, cover, price, live flag. Publishing is per-product and independent — approving the bundle does not publish the singles, and vice versa.
7. **Reject → regenerate.** Captures a reason → regenerates once, using the reason as guidance → the row returns to the checkpoint.
   - Second rejection → route to manual fix: create a tracked task under `.scratch/<feature-slug>/issues/NN-*.md` carrying the draft, its check failures, and the reject reason.
8. **Done** when every row is approved or routed to manual fix.

## Checkpoint brief (admin UI)

One card per BOW entry. Inside the card, one row per product (bundle + each single). Each row shows:

- Product name and competencies covered
- Per-check pass/fail (3 checks) and risk flags
- Link to open the draft itself
- Price (prefilled from config; editable per entry — override at publish)
- Cover preview (auto-generated; overridable)
- Approve / Reject buttons (reject asks for a reason)

Speed of review is imperative: a full entry card is decidable in under a minute.

## Config

- Prices per artifact type: bundle ₱249, lesson plan ₱99, slides ₱59, exam ₱59, worksheet ₱59. Per-entry override at publish.
- Default artifact set: full set (bundle + 4 singles) per entry; trimming happens at review (reject a row and it never publishes).
- AI provider + model per ADR-0002 registry config.
- Cover style.

## Error handling

- Entry generation failure → mark the row failed, route to manual fix (`.scratch/` task) with the error attached. Never silently skip an entry.
- API/persistence failure mid-run → abort the run, log via `@eduksource/logger`, surface an alert card in the admin checkpoint. Safe to re-run from the identify step (normalized-text hash makes extraction idempotent).

## References

- ADR-0001 (runtime split), ADR-0002 (provider registry), ADR-0003 (api sole DB owner), ADR-0007 (BOW extraction durability), ADR-0008 (identity: normalized-text hash + catalog safety net).
- `apps/studio` extraction routes, `apps/studio/src/lib/ai/` provider registry (existing).
- Planned: `apps/api` internal endpoints (`/internal/bow-documents`, `/internal/products`), `apps/admin` review surface.