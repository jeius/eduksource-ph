# ADR-0008: BOW Extraction Identity — Normalized-Text Hash, With a Catalog Safety Net

**Status:** Accepted
**Date:** 2026-08-17
**Supersedes (partially):** ADR-0007's identity mechanism. ADR-0007's core decision — durable, `api`-owned records for BOW extractions — stands unchanged. Only *how identity is computed* is revised here.

## Context

ADR-0007 keyed `bow_documents` identity off a raw SHA-256 hash of the uploaded PDF's bytes. That breaks on the single most common real-world trigger for needing this cache at all: an admin loses their local copy and re-downloads the "same" BOW from DepEd's repository. Two downloads of a visually-identical document routinely differ at the byte level — embedded generation timestamps, per-request watermarking, PDF producer/version metadata — none of which change the document's actual content, all of which change a raw-byte hash. The scenario that motivated durable caching in the first place is also the scenario most exposed to this failure mode, since a re-download is exactly where such noise gets introduced.

A tempting fix — hash the *extracted text* instead of the raw bytes — turns out not to be sufficient on its own either, even for a cleanly-parsed PDF. BOW documents are page-repeated-letterhead-heavy and table-heavy: a repeated header/footer block appearing once per page changes count if the document reflows onto a different number of pages between two exports, and multi-column table extraction order can shift between different PDF generation tool versions, with zero actual change in content.

## Decision

**Identity is the SHA-256 hash of *normalized* extracted text, not raw file bytes and not raw extracted text.** Normalization: strip repeated header/footer lines (detected as lines that repeat near-verbatim across pages), collapse whitespace, drop page-number-like tokens — then hash. This is computed from the cheap, non-AI text extraction step (`unpdf`/`pdfjs-dist`), which already runs before any paid AI call, so normalization adds no new cost to the pipeline.

**This is explicitly not claimed to be sufficient alone.** Scanned/image-heavy PDFs with little extractable text don't benefit much from text-based normalization, and no normalization heuristic is provably complete for a document type this table- and pagination-heavy. So identity gets a second, complementary layer: on a hash miss, Studio checks whether a record already exists for the same `(gradeLevel, learningArea, schoolYear)` under a *different* hash. If one does, the admin gets a non-blocking prompt — "we already have an extraction for this grade/subject/year, reuse it or continue as new?" — rather than a silent, costly re-extraction.

## Alternatives Considered

- **Keep raw-byte hashing (ADR-0007's original mechanism)** — rejected. Fails on the exact scenario ("lost the file, re-downloaded it") that justifies durable caching existing at all.
- **Raw extracted-text hashing, no normalization** — rejected as insufficient on its own. Better than byte hashing, but still exposed to repagination and table-extraction-order drift specific to this document type, evidenced directly by the structure of real uploaded BOW samples.
- **Catalog-first: admin always picks from an existing list or explicitly uploads new, no automatic hashing at all** — considered seriously, ultimately not chosen as the *primary* mechanism (though its safety-net form is adopted). A pure catalog approach removes the hashing problem entirely and is arguably the better long-term UX, but requires more upfront UI (a browse/pick screen) than the prototype needs right now, and throws away a cheap, mostly-effective automatic win in exchange for a human always having to make the call. The soft-warning version gets most of the benefit — human judgment only engaged when the automatic check is uncertain — without the UI cost of making it the primary flow from day one.
- **Blocking gate instead of soft warning** — rejected. A false positive on a blocking check costs the admin real friction (can't proceed without resolving an ambiguous prompt); a false positive on a non-blocking soft warning costs one confirmation click. Given the identity check isn't provably complete (see Decision), a blocking gate would fail loudly on exactly the cases where the check is least certain.

## Consequences

**Gets easier:**

- The common case — same document, re-downloaded, minor byte-level noise — hits cache correctly with zero UI involvement.
- The residual, harder cases (scanned documents, genuine extraction variance) get caught by a cheap human check instead of failing silently, without requiring the automated check to be perfect.

**Gets harder / new obligations:**

- Normalization logic (header/footer stripping, page-number token detection) is new code with its own correctness surface — needs validation against real re-downloaded BOW samples before being trusted, not just assumed to work (tracked in `docs/specs/2026-08-17-bow-extraction-caching-design.md` §7).
- The near-duplicate check requires `gradeLevel`/`learningArea`/`schoolYear` to be known before or immediately after extraction completes, which slightly couples the identity check to admin-supplied upload metadata rather than being purely a function of the file itself.
- Two mechanisms to reason about (hash + catalog check) instead of one — accepted deliberately, since neither alone was judged sufficient.

**See also:** `docs/specs/2026-08-17-bow-extraction-caching-design.md` §2 and §5, which this ADR summarizes the reasoning for.
