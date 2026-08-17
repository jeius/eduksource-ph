# PDF Extraction Route Design

## Overview

Create POST `/api/extract` Hono route. Accept multipart PDF. Use `unpdf` to extract raw text. Send text to NVIDIA NIM LLM via existing `nimChat` helper. Prompt LLM to output structured BOW objectives JSON. Return JSON with text, page count, objectives.

## File Layout

- `src/lib/pdf.ts` – wrapper around `unpdf` extraction.
- `src/routes/extract.ts` – route definition, Zod validation, NIM prompt, error handling.
- `src/routes/extract.test.ts` – Vitest test using fixture PDF.
- `tests/fixtures/bow-sample.pdf` – test PDF (git‑ignored).

## Data Shapes

```ts
interface BowTerm {
  termLabel: string; // verbatim: "First Term", "Second Term", "Third Term"
  contentStandard: string;
  performanceStandard: string;
  competencyGroups: BowCompetencyGroup[];
}

interface BowCompetencyGroup {
  topicLabel: string; // verbatim: "Literary Text | Poetry and Prose"
  subheading: string | null; // verbatim: "Evaluating literary texts"
  week: string | null; // verbatim from source cell ("*" or an actual number) — never invented
  competenciesRaw: string; // the nested bullet list preserved as indented markdown, not flattened
}

interface ExtractResponse {
  text: string;
  pages: number;
  terms: BowTerm[]; // Array of three terms
  warnings: string[]; // e.g., "2 of 10 competency groups had parse issues"
  notes: string[]; // e.g., "Week field contained '_' for group X"
}
```

Response `{ text: string; pages: number; terms: BowTerm[]; warnings: string[]; notes: string[] }`.

## Flow

1. Receive file.
2. Validate MIME `application/pdf` with Zod.
3. Enforce limits: max 50 pages, max 10 MB.
4. Compute SHA-256 of file. Check cache (in-memory or Redis if available). If hit → return cached.
5. Call `extractText` from `src/lib/pdf.ts` (uses `unpdf`).
6. If extracted text is empty or < 100 chars → trigger **NIM vision fallback** (call NIM vision model with PDF as image). Log which path used.
7. Check token budget: estimate tokens (text.length \* 1.3). If > 80% of model context window → split by term and process each term separately, then merge.
8. Build prompt:

   ```text
   SYSTEM:
   You are extracting structured curriculum data from a Philippine DepEd Budget of Work (BOW) document. Extract only what is explicitly present in the source text — never infer, estimate, or invent a value.

   Rules:
   - If a field is not explicitly stated in the source (e.g. the Week column shows "_" instead of a number), output it verbatim as given ("_"), or null if truly absent. Never substitute a guessed number.
   - Use the source document's own terminology for structural labels (e.g. "Term", not "Quarter") — do not rename or reinterpret document structure.
   - Preserve competency lists as nested markdown exactly as they appear (including sub-bullets), rather than splitting each line into a separate object — a single competency often has multiple sub-elements that belong together.
   - Capture Content Standard and Performance Standard for each term exactly as written.
   - If a value spans multiple lines or has OCR/extraction artifacts (stray characters, broken words), reproduce it as-is rather than silently correcting it — flag uncertainty in a "notes" field instead of fixing it yourself.

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
13. Validate each `competencyGroups` entry. If 8/10 pass, return the 8 + warning "2 competency groups omitted due to validation failure".
14. Log NIM token usage (input/output tokens from response metadata).
15. Cache result by file hash.
16. Return JSON, status 200.

## Error Handling

- Missing/invalid file → 400.
- File too large (>10 MB) or too many pages (>50) → 413.
- `unpdf` throws → try NIM vision fallback; if both fail → 500, log error.
- NIM parsing fails after retry → 500, include raw LLM output.

## Tests (Vitest)

- Valid PDF → returns three terms with competencyGroups.
- Non‑PDF → 400.
- Empty PDF → graceful 200 with empty terms/warnings.
- PDF with `week: "*"` → preserved verbatim, not null.
- PDF with deeply nested multi-level competency block → `competenciesRaw` preserves nesting as markdown.
- 51-page PDF → 413.
- 15 MB PDF → 413.
- Cache hit on second upload of same file → skips NIM call, logs "cache hit".
- Malformed JSON from LLM → retry once, then 500 with raw output.
- Partial validation failure → returns valid groups + warning array.

## Dependencies

- `unpdf` (runtime).
- Optional `pdfjs-dist` if custom PDF.js build needed.
- Cache: in-memory `Map<string, ExtractResponse>` (dev); Redis for prod.

## Observability

- Structured log per request: `{ fileHash, pages, textLength, tokensUsed, latencyMs, cacheHit, path: "unpdf" | "vision-fallback" }`.

## Git Commit

`feat(studio): add PDF extraction route using unpdf and NIM with vision fallback, caching, and token budgeting`.
