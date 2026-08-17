# PDF Extraction Route Design (v3)

## Overview

Create POST `/api/extract` Hono route. Accept multipart PDF. Use `unpdf` to extract raw text, falling back to NIM vision OCR for scanned/image-based documents. Send text to NVIDIA NIM LLM via existing `nimChat` helper, prompted to output a structured `BowDocument` — a schema validated against seven real DepEd BOW subjects (English, Filipino literature, Values Education, Science, MAPEH, Mathematics, Life and Career Skills, Araling Panlipunan) spanning both English- and Filipino-labeled source documents.

## File Layout

- `src/lib/pdf.ts` – wrapper around `unpdf` extraction, plus NIM vision fallback.
- `src/routes/extract.ts` – route definition, Zod validation, NIM prompt, error handling.
- `src/routes/extract.test.ts` – Vitest test using fixture PDFs.
- `tests/fixtures/bow-*.pdf` – test PDFs covering each structural pattern below (git‑ignored).

## Data Shapes

```ts
interface BowDocument {
  learningArea: string;          // from the document's own header text, e.g. "General Mathematics" — not the filename
  gradeLevel: string;
  documentNotes: string | null;  // global notes outside any term/week, e.g. MAPEH's time-allocation note
  terms: BowTerm[];
}

interface BowTerm {
  termLabel: string;              // verbatim, in source language: "First Term" or "Unang Termino"
  contentStandard: string[] | null;
  performanceStandard: string[] | null;
  skillsFocus: SkillsFocus | null;    // term-level focus field, e.g. "Essential Life Skills"
  blocks: BowBlock[];
  suggestedActivities: string[] | null;      // term-level, when present (e.g. Science)
  suggestedPerformanceTasks: string[] | null; // term-level, when present (e.g. Science)
}

interface BowBlock {
  weekLabel: string;               // verbatim: "*", "1 to 2", "13", "1", "Linggo 1"
  durationDays: number | null;     // only if explicitly stated — never inferred from a range
  contentStandard: string[] | null;    // present here instead of term-level when the source scopes it per-block
  performanceStandard: string[] | null;
  skillsFocus: SkillsFocus | null;     // block-level focus field, e.g. "Values to be Developed"
  strands: BowStrand[];            // one or more — most subjects have exactly one, MAPEH/Math often have two+
  extractionNotes: string | null;  // flags ambiguous/malformed source text instead of silently fixing it
}

interface BowStrand {
  strandLabel: string | null;      // "Music and Arts", "Number and Algebra" — null if source doesn't restate one
  topicLabel: string | null;       // subheading under the strand, e.g. "Evaluating literary texts"
  competenciesRaw: string;         // preserved verbatim structure — nested bullets, lettered sub-points, as the source uses them
}

interface SkillsFocus {
  sourceLabel: string;             // verbatim field name as the document uses it, e.g. "Essential Life Skills"
  items: { text: string; gloss: string | null }[]; // one item for value+gloss pattern; many for a plain list
}

interface ExtractResponse {
  text: string;
  pages: number;
  document: BowDocument;
  warnings: string[];   // e.g., "2 of 10 competency blocks had parse issues"
  notes: string[];      // aggregated extractionNotes across all blocks, for quick scanning
}
```

## Flow

1. Receive file.
2. Validate MIME `application/pdf` with Zod.
3. Enforce limits: max 50 pages, max 10 MB.
4. Compute SHA-256 of file. Check cache (in-memory or Redis if available). If hit → return cached, log `cacheHit: true`.
5. Call `extractText` from `src/lib/pdf.ts` (uses `unpdf`).
6. If extracted text is empty or < 100 chars → trigger **NIM vision fallback** (send PDF pages as images to the NIM vision/OCR model). Log which path was used.
7. Check token budget: estimate tokens (`text.length * 1.3`). If > 80% of the model's context window → split by term and process each term separately, then merge into one `BowDocument`.
8. Build prompt:

   ```text
   SYSTEM:
   You are extracting structured curriculum data from a Philippine DepEd Budget of Work (BOW)
   document. Extract only what is explicitly present in the source text — never infer, estimate,
   or invent a value.

   Rules:
   - If a field is not explicitly stated in the source (e.g. the Week column shows "*" instead of
     a number), output it verbatim as given ("*"), or null if truly absent. Never substitute a
     guessed number.
   - Use the source document's own terminology for structural labels (e.g. "Term", not "Quarter")
     — do not rename or reinterpret document structure.
   - This document's field labels may appear in Filipino instead of English (e.g. "Linggo" = Week,
     "Kasanayang Pampagkatuto" = Learning Competency, "Pamantayang Pangnilalaman" = Content
     Standard, "Pamantayan sa Pagganap" = Performance Standard, "Unang/Ikalawang/Ikatlong
     Termino" = First/Second/Third Term, "Baitang" = Grade). Recognize these by meaning and map
     them to the correct schema field, but store term/week labels verbatim in the source's own
     language — do not translate them yourself.
   - Preserve competency lists as nested markdown exactly as they appear (including sub-bullets
     and lettered sub-points), rather than splitting each line into a separate object — a single
     competency often has multiple sub-elements that belong together.
   - Content Standard and Performance Standard may be a single paragraph or a list of multiple
     distinct statements. Capture each as a separate array entry rather than merging them into
     one string. Capture them wherever they are explicitly stated in the source — per-term or
     per-week-block — do not assume one applies to blocks that do not restate it, and do not copy
     a term-level value down into blocks as if it were repeated.
   - A single week block may contain more than one labeled strand or subject component (e.g. two
     subjects bundled under one week number, or two content strands like "Geometry" and "Algebra"
     in the same week). Extract each strand separately with its own label — do not merge multiple
     strands' competencies into one undifferentiated list.
   - A strand or topic label may be stated once and apply to several following blocks without
     being restated. Do not infer or repeat a label onto a block that does not state one — leave
     it null.
   - If the source includes a subject-specific field naming skills or values to be developed (e.g.
     "Values to be Developed," "Essential Life Skills"), capture the source's own field label
     verbatim along with each listed item. Preserve any parenthetical gloss given; leave gloss
     null if none is given — do not add a translation yourself.
   - Capture any document-level notes that apply to the whole BOW rather than one term or week
     (e.g. scheduling/time-allocation notes) in documentNotes — do not attach them to an
     individual week block.
   - If a value spans multiple lines, has OCR/extraction artifacts (stray characters, broken
     words), or appears to run two items together without proper spacing (a likely document
     artifact), reproduce it as-is rather than silently correcting or splitting it — flag the
     ambiguity in that block's extractionNotes field instead of fixing it yourself.

   Return only valid JSON matching this schema, no other text:
   {schema here}

   USER:
   Extract structured data from the following BOW document text:

   {extracted_text}
   ```

9. Call `nimChat` with prompt.
10. Parse LLM response with Zod schema.
11. If parse fails → **retry once** with error message appended: "Previous output failed JSON parse: {error}. Return only valid JSON."
12. If retry fails → return 500 with raw LLM output for debugging.
13. Validate each `BowBlock` entry. If 8/10 pass, return the 8 + warning "2 competency blocks omitted due to validation failure".
14. Log NIM token usage (input/output tokens from response metadata).
15. Cache result by file hash.
16. Return JSON, status 200.

## Error Handling

- Missing/invalid file → 400.
- File too large (>10 MB) or too many pages (>50) → 413.
- `unpdf` throws or returns near-empty text → try NIM vision fallback; if both fail → 500, log error.
- NIM parsing fails after retry → 500, include raw LLM output.

## Tests (Vitest)

Fixtures should cover the structural patterns actually observed across the seven source BOWs reviewed, not just generic PDF-handling cases:

- Valid PDF → returns a `BowDocument` with terms and blocks.
- Non-PDF → 400.
- Empty PDF → graceful 200 with empty terms/warnings.
- Week label `"*"` → preserved verbatim, not null or coerced to a number.
- Week label as a range with day count (`"1 to 2 (10 days)"`) → `weekLabel` and `durationDays` both captured, range not collapsed to a single number.
- Deeply nested multi-level competency block (5+ levels, e.g. Life and Career Skills) → `competenciesRaw` preserves full nesting as markdown.
- Content/Performance Standard as a bulleted list of multiple statements (Science) → captured as multiple array entries, not one merged string.
- Content/Performance Standard scoped per-block rather than per-term (Values Education) → captured on `BowBlock`, not duplicated onto `BowTerm`.
- Single week block containing two labeled strands (MAPEH: Music and Arts + PE and Health; Math: Geometry + Algebra) → two separate `BowStrand` entries, not merged.
- Document-level note outside any term/week (MAPEH's time-allocation note) → captured in `documentNotes`, not attached to a block.
- Subject-specific focus field with gloss (Values Education's "Values to be Developed") → captured in `skillsFocus` with one item + gloss.
- Subject-specific focus field without gloss, comma-separated list (Life and Career Skills' "Essential Life Skills") → captured in `skillsFocus` with multiple items, `gloss: null`.
- Filipino-labeled document (Araling Panlipunan: "Linggo," "Kasanayang Pampagkatuto," "Unang Termino") → correctly mapped to schema fields; term/week labels preserved in Filipino, not translated.
- Source text with a run-together artifact (missing space between two sentences) → reproduced verbatim, flagged in `extractionNotes`, not silently split or corrected.
- 51-page PDF → 413.
- 15 MB PDF → 413.
- Cache hit on second upload of same file → skips NIM call, logs "cache hit".
- Malformed JSON from LLM → retry once, then 500 with raw output.
- Partial validation failure → returns valid blocks + warning array.

## Dependencies

- `unpdf` (runtime).
- Optional `pdfjs-dist` if custom PDF.js build needed.
- Cache: in-memory `Map<string, ExtractResponse>` (dev); Redis for prod.

## Observability

- Structured log per request: `{ fileHash, pages, textLength, tokensUsed, latencyMs, cacheHit, path: "unpdf" | "vision-fallback", learningArea, termCount }`.

## Open Question Before Implementation

Seven subjects and two source languages have been reviewed, converging on this shape without further structural rewrites (only field generalizations in the last two passes). Before finalizing: this has not yet been tested against a senior-high specialized/track subject (e.g. STEM, ABM, HUMSS strand-specific electives) or a document with genuinely no table structure at all (pure prose BOW, if any exist). Worth a quick check against one such document if available, but not a blocker for building against this schema now.

## Git Commit

`feat(studio): add PDF extraction route using unpdf and NIM, with multi-subject BOW schema, vision fallback, caching, and token budgeting`