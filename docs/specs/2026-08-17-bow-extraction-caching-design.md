# Studio — BOW Extraction Caching & Persistence Spec

**Status:** Finalized — implementation spec. Persistence and identity decisions are written up in ADR-0007 and ADR-0008 respectively.
**Depends on:** ADR-0003 (Studio never writes to Postgres directly), `docs/specs/2026-08-17-lesson-plan-generation-design.md` (consumes `extractionId`).
**Supersedes:** the "ephemeral in-memory cache, random UUID, ~60min TTL" design from `2026-08-17-lesson-plan-generation-design.md` §2 — see §6 for the reconciliation.
**Revision note:** originally specced identity as a raw-byte SHA-256 hash of the uploaded PDF (§2 below has been revised since); `school_year` was originally an open item, now resolved as required (§4, §7).

---

## 1. Problem

A BOW PDF for a given grade level + learning area is a stable, reusable document — it doesn't change week to week. An editor generates materials for it incrementally, term by term, week by week, likely across many separate sessions over a school year. A cache that only lives for the duration of one sitting forces re-extraction (including any vision-model fallback calls) every time the editor comes back, even though nothing about the source document changed. That's wasted latency and wasted AI spend on a step that should only ever need to happen once per document.

## 2. Identity: normalized extracted text, not raw file bytes

The original version of this spec keyed identity off a raw SHA-256 of the uploaded PDF's bytes. That breaks on the single most common real-world trigger for needing this cache at all: an admin loses their local copy and re-downloads the "same" BOW from DepEd's repository. Two downloads of a visually-identical document routinely differ at the byte level — embedded generation timestamps, per-request watermarking, PDF producer/version metadata — none of which change the actual content, all of which change the hash.

**Revised identity: hash the normalized extracted text, not the raw PDF bytes.**

1. Run the cheap, non-AI text extraction (`unpdf`/`pdfjs-dist`) first — always, regardless of cache status, since it's fast and doesn't touch a paid AI call.
2. **Normalize** the extracted text before hashing: strip repeated header/footer lines (detectable — they're the lines that repeat near-verbatim across pages, e.g. a school's address block appearing once per page), collapse whitespace, drop page-number-like tokens.
3. Hash the normalized text. This becomes `contentHash`.

This directly addresses the concrete drift pattern real BOW documents exhibit — repaginated exports, minor tooling-version differences, and per-page repeated letterhead blocks all wash out under normalization even though they'd change a raw byte hash every time.

**What this doesn't fully solve, honestly:** scanned/image-heavy PDFs with little extractable text still need the vision path to know anything meaningful, and normalization can't help a case where the extracted text genuinely differs in some way a human wouldn't consider meaningful but a normalizer wasn't written to catch. `contentHash` alone is meaningfully better than the raw-byte version, not a guarantee. See §5 for the safety net that catches the residual cases without needing the hash to be perfect.

`gradeLevel`, `learningArea`, and `schoolYear` are **not** part of the identity key — they're descriptive/lookup metadata (§4), used for the admin browsing UI and the soft-warning check in §5, not for dedup itself.

`extractionId` in the API is the content hash (or a short, URL-safe encoding of it) — one identifier, meaningful on its own, usable at both cache tiers below.

## 3. Two-tier cache

| Tier | Scope | Storage | Purpose |
| --- | --- | --- | --- |
| **L1 — session cache** | One Studio process, short TTL (~60 min) | In-memory | Fast repeated access within one active admin session — generating six weeks of lesson plans off the same BOW shouldn't hit R2/api six times |
| **L2 — durable record** | Permanent, shared across all sessions and time | `api`-owned Postgres row + R2 blobs | The actual reuse win — "has this exact document ever been extracted, by anyone, ever" |

L1 is populated from L2 on a cache miss (or from a fresh extraction on a full miss), and both are keyed by the same `contentHash`.

## 4. Data model (owned by `api`, per ADR-0003)

Following the same pattern already established for generated products — R2 holds the actual bytes, Postgres holds a lightweight index row, `api` is the only thing that writes it:

```txt
bow_documents
  id                  uuid, pk
  content_hash        text, unique, indexed        -- SHA-256 of NORMALIZED EXTRACTED TEXT (§2), not raw file bytes
  grade_level         text, indexed
  learning_area       text, indexed
  school_year         text, NOT NULL, indexed       -- required — DepEd curricula are revised across years,
                                                     -- so the same grade/subject can be a genuinely different
                                                     -- document year to year (resolved, was an open item)
  source_pdf_key      text                          -- R2 key of the original upload
  extraction_json_key text                          -- R2 key of the stored ExtractResponse
  extraction_provider text, nullable                 -- which AI provider/model, if vision fallback was used
  extraction_model    text, nullable
  extracted_at        timestamp
  created_by          uuid, references users
```

Extraction JSON lives in R2 as a blob (`extraction_json_key`), **not** inline as a Postgres `jsonb` column — a full BOW extraction (text + structured document) is exactly the kind of payload that doesn't belong bloating the primary transactional database, and Studio already has direct R2 write access for this (ADR-0001). Postgres only holds the index needed to find it.

## 5. Endpoint changes, with the catalog safety net

```ts
// POST /extract  (Studio)
type ExtractRequest = { file: Buffer /* or however uploads are handled */ };

type ExtractResponseWithId = ExtractResponse & {
  extractionId: string;                 // = contentHash (§2)
  possibleDuplicateOf?: {                // present only when §5's soft-warning check fires
    bowDocumentId: string;
    gradeLevel: string;
    learningArea: string;
    schoolYear: string;
  };
};
```

**Flow on a call to `/extract`:**

1. Studio runs text extraction first (always — cheap, no AI call), then computes `contentHash` from the **normalized** text (§2).
2. Studio checks **L1** (in-memory) for `contentHash`. Hit → return immediately.
3. Miss → Studio calls `api`'s `GET /internal/bow-documents?contentHash=...`.
   - **Hit:** fetch the `ExtractResponse` from R2 via `extraction_json_key`, populate L1, return it. **The extraction pipeline — including any vision-model fallback — never runs.** This is the real cost/latency win.
   - **Miss:** before running full extraction, check for a **near-duplicate**: does a record already exist for the same `(gradeLevel, learningArea, schoolYear)`, just under a different `contentHash`? (Grade/subject/year can only be known once the admin has supplied or the extraction has inferred them — if this check needs to happen before extraction, it runs off admin-supplied metadata at upload time; if after, it runs once extraction completes.) If so, **don't silently re-extract** — return `possibleDuplicateOf` so the admin app can prompt "we already have an extraction for this grade/subject/year — reuse it, or continue as a new document?" A false negative here costs nothing (same as not having the check). A false positive costs one confirmation click. Compare that to the alternative: a hash miss silently triggering a full, costly re-extraction with no human ever aware it happened.
   - If the admin proceeds as new (or no near-duplicate exists): run extraction, then
     a. upload the source PDF to R2 (if not already stored)
     b. upload the resulting `ExtractResponse` to R2
     c. call `api`'s `POST /internal/bow-documents` with `contentHash`, `gradeLevel`, `learningArea`, `schoolYear`, both R2 keys, and extraction provider/model metadata — `api` creates the row
     d. populate L1, return the result

Two new internal `api` endpoints, same internal-service-token auth as the existing `/internal/products` route — no new auth mechanism needed, just two more routes behind the auth Studio already has.

**Why both layers, not just one:** normalized-text-hashing catches the common case (re-download of an unchanged document) automatically, with no UI required. The near-duplicate check catches what normalization can't guarantee (scanned documents, genuine extraction variance) without needing the hash to be perfect — the two are complementary, not redundant.

## 6. Reconciling with `2026-08-17-lesson-plan-generation-design.md`

That spec's §2 currently says `extractionId` is a random UUID with a flat 60-minute TTL and no durability. This spec supersedes that: `extractionId` is now the normalized-text content hash, backed by the two-tier cache above. Nothing about the lesson-plan generation endpoint's own contract changes — it still just takes an `extractionId` string and looks up the cached extraction.

## 7. Open items

- ~~School-year scoping~~ — **Resolved:** `school_year` is required (§4). DepEd curricula get revised across years; a "Grade 9 Math BOW" from SY 2025-2026 is treated as a genuinely different document from SY 2026-2027 even if similar in content.
- ~~Identity mechanism~~ — **Resolved:** normalized-text-hash + near-duplicate soft-warning (§2, §5).
- **Admin UI reuse.** The near-duplicate prompt in §5 is the first real UI surface for this, but a full "browse and pick an existing BOW instead of uploading" catalog view is still a future addition, not required for this spec — the data model already supports it when someone builds it.
- **Retention/cleanup.** No expiry proposed for L2 records or their R2 blobs — low-volume enough to defer, tracked in `docs/plan.md` §3 (Risks).
- **Normalization heuristic itself needs validation against real samples** — "strip repeated header/footer lines, collapse whitespace, drop page-number tokens" is a reasonable first pass, not a proven one. Worth testing against a handful of real re-downloaded BOWs before trusting it fully.
