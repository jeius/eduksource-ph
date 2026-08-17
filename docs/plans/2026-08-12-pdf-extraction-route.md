# PDF Extraction Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement POST `/api/extract` route in the studio Hono app that accepts a BOW PDF, extracts text via `unpdf`, falls back to NIM vision model if needed, sends text to NIM LLM for structured extraction, and returns validated BOW terms with competency groups.

**Architecture:** Single Hono route backed by modular libs (`src/lib/pdf.ts` for extraction, `src/lib/nim.ts` already exists for LLM calls). In-memory cache for dev. Zod schemas for request/response validation. Vitest tests with fixture PDFs.

**Tech Stack:** Hono (Node), `unpdf`, `pdfjs-dist` (optional), NVIDIA NIM via OpenAI-compatible client, Zod, Vitest.

## Global Constraints

- Run on Node (not Cloudflare Workers) — `tsx` dev, `tsc` build.
- pnpm workspace — install deps via `pnpm add -w` at workspace root or per-package.
- Biome for lint/format — run `pnpm format` before committing.
- TypeScript strict — no `any` unless explicit comment.
- Convention: routes under `src/routes/`, libs under `src/lib/`, fixtures under `tests/fixtures/`.
- Environment vars in `.env` (NVIDIA_API_KEY, NVIDIA_NIM_BASE_URL, NIM_MODEL_REASONING, NIM_MODEL_VISION).
- Existing `nimChat` in `src/lib/nim.ts` used for LLM calls; add vision model call alongside it.
- File upload limits: max 50 pages, 10 MB.
- Cache: in-memory `Map<string, ExtractResponse>`.
- Log structured JSON per request.

---

### Task 1: Install Dependencies

**Files:**

- Modify: `apps/studio/package.json`

**Interfaces:** None (foundational)

- [ ] **Step 1.1: Add `unpdf` and `pdfjs-dist` to dependencies**

```bash
cd apps/studio && pnpm add unpdf pdfjs-dist
```

Expected: adds to `package.json` dependencies.

- [ ] **Step 1.2: Run typecheck to verify types available**

```bash
pnpm --filter=@eduksource/studio check-types
```

Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/studio/package.json
git commit -m "feat(studio): add unpdf and pdfjs-dist for PDF extraction"
```

---

### Task 2: Create PDF Extraction Library (`src/lib/pdf.ts`)

**Files:**

- Create: `apps/studio/src/lib/pdf.ts`

**Interfaces:**

- Produces: `extractText(file: Uint8Array): Promise<{ text: string; pages: number }>`

- [ ] **Step 2.1: Write failing test**

```typescript
// apps/studio/src/lib/pdf.test.ts
import { describe, it, expect } from "vitest";
import { extractText } from "./pdf.js";

describe("extractText", () => {
  it("extracts text and page count from a simple PDF fixture", async () => {
    const fixture = new Uint8Array(
      await Bun.file(
        new URL("./fixtures/simple.pdf", import.meta.url),
      ).arrayBuffer(),
    );
    const result = await extractText(fixture);
    expect(result.pages).toBeGreaterThan(0);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter=@eduksource/studio test src/lib/pdf.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 2.3: Implement `pdf.ts`**

```typescript
// apps/studio/src/lib/pdf.ts
import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";
import { definePDFJSModule } from "unpdf";

// Initialize PDF.js once
await definePDFJSModule(() => import("pdfjs-dist"));

export async function extractText(
  file: Uint8Array,
): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(file);
  const { text, totalPages } = await unpdfExtractText(pdf, {
    mergePages: true,
  });
  return { text, pages: totalPages };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
pnpm --filter=@eduksource/studio test src/lib/pdf.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Create minimal fixture PDF**

```bash
mkdir -p apps/studio/tests/fixtures
# Create a simple 1-page PDF programmatically or copy a minimal test PDF
```

- [ ] **Step 2.6: Commit**

```bash
git add apps/studio/src/lib/pdf.ts apps/studio/src/lib/pdf.test.ts apps/studio/tests/fixtures/simple.pdf
git commit -m "feat(studio): add PDF text extraction library using unpdf"
```

---

### Task 3: Add Vision Fallback to NIM Library (`src/lib/nim.ts`)

**Files:**

- Modify: `apps/studio/src/lib/nim.ts`

**Interfaces:**

- Consumes: `nimChat` (existing)
- Produces: `nimVisionChat(imageBase64: string, prompt: string): Promise<string>`

- [ ] **Step 3.1: Write failing test**

```typescript
// apps/studio/src/lib/nim.test.ts
import { describe, it, expect, vi } from "vitest";
import { nimVisionChat } from "./nim.js";

describe("nimVisionChat", () => {
  it("calls NIM vision model with base64 image and prompt", async () => {
    // Mock OpenAI client - see existing test patterns
    // Verify call made with vision model and correct params
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
pnpm --filter=@eduksource/studio test src/lib/nim.test.ts
```

Expected: FAIL (function not exported).

- [ ] **Step 3.3: Add `nimVisionChat` to `nim.ts`**

```typescript
// In apps/studio/src/lib/nim.ts
// Add after existing exports
const visionModel = env.NIM_MODEL_VISION;

export async function nimVisionChat(
  imageBase64: string,
  prompt: string,
): Promise<string> {
  const openai = new OpenAI({ apiKey: API_KEY, baseURL });
  const completion = await openai.chat.completions.create({
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 8192,
  });
  return completion.choices[0]?.message.content ?? "";
}
```

- [ ] **Step 3.4: Add `NIM_MODEL_VISION` to env config**

```typescript
// apps/studio/src/config/env.ts - add
NIM_MODEL_VISION: z.string().default("nvidia/nemotron-3-ultra-vision"),
```

- [ ] **Step 3.5: Run test to verify it passes**

```bash
pnpm --filter=@eduksource/studio test src/lib/nim.test.ts
```

Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add apps/studio/src/lib/nim.ts apps/studio/src/config/env.ts apps/studio/src/lib/nim.test.ts
git commit -m "feat(studio): add NIM vision fallback for PDF extraction"
```

---

### Task 4: Create Zod Schemas for Request/Response

**Files:**

- Create: `apps/studio/src/schemas/extract.ts`

**Interfaces:**

- Produces: `ExtractRequestSchema`, `ExtractResponseSchema`, `BowTermSchema`, `BowCompetencyGroupSchema`

- [ ] **Step 4.1: Write failing test**

```typescript
// apps/studio/src/schemas/extract.test.ts
import { describe, it, expect } from "vitest";
import { ExtractRequestSchema, ExtractResponseSchema } from "./extract.js";

describe("extract schemas", () => {
  it("validates valid response", () => {
    const valid = { text: "x", pages: 1, terms: [{ termLabel: "First Term", contentStandard: "...", performanceStandard: "...", competencyGroups: [{ topicLabel: "...", subheading: null, week: "*", competenciesRaw: "- item" }] }, ...], warnings: [], notes: [] };
    expect(ExtractResponseSchema.parse(valid)).toEqual(valid);
  });
  it("rejects missing required fields", () => {
    expect(() => ExtractResponseSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
pnpm --filter=@eduksource/studio test src/schemas/extract.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4.3: Implement `extract.ts` schemas**

```typescript
// apps/studio/src/schemas/extract.ts
import { z } from "zod";

export const BowCompetencyGroupSchema = z.object({
  topicLabel: z.string(),
  subheading: z.string().nullable(),
  week: z.string().nullable(), // verbatim: "*", "1", etc.
  competenciesRaw: z.string(), // nested markdown preserved
});

export const BowTermSchema = z.object({
  termLabel: z.string(),
  contentStandard: z.string(),
  performanceStandard: z.string(),
  competencyGroups: z.array(BowCompetencyGroupSchema),
});

export const ExtractResponseSchema = z.object({
  text: z.string(),
  pages: z.number().int().nonnegative(),
  terms: z.array(BowTermSchema),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
});

export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;
export type BowTerm = z.infer<typeof BowTermSchema>;
export type BowCompetencyGroup = z.infer<typeof BowCompetencyGroupSchema>;
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
pnpm --filter=@eduksource/studio test src/schemas/extract.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/studio/src/schemas/extract.ts apps/studio/src/schemas/extract.test.ts
git commit -m "feat(studio): add Zod schemas for PDF extraction response"
```

---

### Task 5: Implement Cache Utility

**Files:**

- Create: `apps/studio/src/lib/cache.ts`

**Interfaces:**

- Produces: `ExtractionCache` class with `get(hash)`, `set(hash, value)`, `hashFile(buffer)`

- [ ] **Step 5.1: Write failing test**

```typescript
// apps/studio/src/lib/cache.test.ts
import { describe, it, expect } from "vitest";
import { ExtractionCache } from "./cache.js";

describe("ExtractionCache", () => {
  it("stores and retrieves by hash", async () => {
    const cache = new ExtractionCache();
    const hash = await cache.hashFile(new Uint8Array([1, 2, 3]));
    const payload = { text: "x", pages: 1, terms: [], warnings: [], notes: [] };
    cache.set(hash, payload);
    const got = cache.get(hash);
    expect(got).toEqual(payload);
  });
  it("returns undefined for missing key", () => {
    const cache = new ExtractionCache();
    expect(cache.get("nonexistent")).toBeUndefined();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
pnpm --filter=@eduksource/studio test src/lib/cache.test.ts
```

Expected: FAIL.

- [ ] **Step 5.3: Implement `cache.ts`**

```typescript
// apps/studio/src/lib/cache.ts
import { createHash } from "node:crypto";
import type { ExtractResponse } from "../schemas/extract.js";

export class ExtractionCache {
  private map = new Map<string, ExtractResponse>();

  async hashFile(buffer: Uint8Array): Promise<string> {
    return createHash("sha256").update(buffer).digest("hex");
  }

  get(hash: string): ExtractResponse | undefined {
    return this.map.get(hash);
  }

  set(hash: string, value: ExtractResponse): void {
    this.map.set(hash, value);
  }

  clear(): void {
    this.map.clear();
  }
}

export const extractionCache = new ExtractionCache();
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
pnpm --filter=@eduksource/studio test src/lib/cache.test.ts
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/studio/src/lib/cache.ts apps/studio/src/lib/cache.test.ts
git commit -m "feat(studio): add in-memory cache for PDF extraction results"
```

---

### Task 6: Build Extraction Route (`src/routes/extract.ts`)

**Files:**

- Create: `apps/studio/src/routes/extract.ts`

**Interfaces:**

- Consumes: `extractText` (pdf.ts), `nimChat`/`nimVisionChat` (nim.ts), schemas, cache
- Produces: Hono route handler for `POST /api/extract`

- [ ] **Step 6.1: Write failing test (route integration)**

```typescript
// apps/studio/src/routes/extract.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createExtractRoutes } from "./extract.js";

describe("POST /api/extract", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/api", createExtractRoutes());
  });

  it("rejects non-PDF with 400", async () => {
    const res = await app.request("/api/extract", {
      method: "POST",
      body: new FormData().append(
        "file",
        new Blob(["not pdf"], { type: "text/plain" }),
        "test.txt",
      ),
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 for >50 pages", async () => {
    // Mock extractText to return 51 pages
    const res = await app.request("/api/extract", {
      method: "POST",
      body: formDataWithLargePdf,
    });
    expect(res.status).toBe(413);
  });

  it("returns 413 for >10MB", async () => {
    const res = await app.request("/api/extract", {
      method: "POST",
      body: formDataWithLargeFile,
    });
    expect(res.status).toBe(413);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
pnpm --filter=@eduksource/studio test src/routes/extract.test.ts
```

Expected: FAIL (route not found).

- [ ] **Step 6.3: Implement `extract.ts` route — full implementation per spec flow**

```typescript
// apps/studio/src/routes/extract.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { extractText } from "../lib/pdf.js";
import { nimChat, nimVisionChat } from "../lib/nim.js";
import { extractionCache, hashFile } from "../lib/cache.js";
import {
  ExtractResponseSchema,
  type ExtractResponse,
  type BowCompetencyGroup,
} from "../schemas/extract.js";

const MAX_PAGES = 50;
const MAX_BYTES = 10 * 1024 * 1024;
const TOKEN_ESTIMATE_FACTOR = 1.3;
const TOKEN_BUDGET_RATIO = 0.8;
const CONTEXT_WINDOW = 128000; // adjust per model
const MIN_TEXT_FOR_UNPDF = 100;

const FileUploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((f) => f.type === "application/pdf", "Must be PDF"),
});

export function createExtractRoutes() {
  const app = new Hono();

  app.post("/extract", zValidator("form", FileUploadSchema), async (c) => {
    const startMs = Date.now();
    const { file } = c.req.valid("form");

    // Size check
    if (file.size > MAX_BYTES) {
      return c.json({ error: "File too large (max 10 MB)" }, 413);
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const fileHash = await extractionCache.hashFile(buffer);

    // Cache check
    const cached = extractionCache.get(fileHash);
    if (cached) {
      console.log(
        JSON.stringify({
          fileHash,
          cacheHit: true,
          path: "cache",
          latencyMs: Date.now() - startMs,
        }),
      );
      return c.json(cached);
    }

    // Extract text
    let { text, pages } = await extractText(buffer);
    let path: "unpdf" | "vision-fallback" = "unpdf";

    // Page limit check (after extraction)
    if (pages > MAX_PAGES) {
      return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413);
    }

    // Vision fallback if text too short
    if (!text || text.length < MIN_TEXT_FOR_UNPDF) {
      path = "vision-fallback";
      const base64 = Buffer.from(buffer).toString("base64");
      text = await nimVisionChat(
        base64,
        "Extract all text from this BOW document. Return raw text only.",
      );
    }

    // Token budget check
    const estimatedTokens = Math.ceil(text.length * TOKEN_ESTIMATE_FACTOR);
    const maxTokens = Math.floor(CONTEXT_WINDOW * TOKEN_BUDGET_RATIO);
    let terms: ExtractResponse["terms"] = [];

    if (estimatedTokens > maxTokens) {
      // Split by term — heuristic: split on "Term" headers
      const termSections = text
        .split(/(?=First Term|Second Term|Third Term)/i)
        .filter(Boolean);
      for (const section of termSections) {
        const termResult = await extractSingleTerm(section);
        if (termResult) terms.push(termResult);
      }
    } else {
      // Single call for all terms
      const result = await extractAllTerms(text);
      terms = result;
    }

    // Validate each competency group
    const validGroups: BowCompetencyGroup[] = [];
    const warnings: string[] = [];
    for (const term of terms) {
      for (const group of term.competencyGroups) {
        const parsed = BowCompetencyGroupSchema.safeParse(group);
        if (parsed.success) {
          validGroups.push(parsed.data);
        } else {
          warnings.push(
            `Competency group validation failed: ${parsed.error.message}`,
          );
        }
      }
    }

    if (
      validGroups.length <
      terms.reduce((sum, t) => sum + t.competencyGroups.length, 0)
    ) {
      warnings.push(
        `${terms.reduce((sum, t) => sum + t.competencyGroups.length, 0) - validGroups.length} competency groups omitted due to validation failure`,
      );
    }

    const response: ExtractResponse = {
      text,
      pages,
      terms: terms.map((t) => ({
        ...t,
        competencyGroups: t.competencyGroups.filter((g) =>
          validGroups.some((vg) => vg.topicLabel === g.topicLabel),
        ),
      })),
      warnings,
      notes: [],
    };

    // Cache result
    extractionCache.set(fileHash, response);

    // Log structured
    console.log(
      JSON.stringify({
        fileHash,
        pages,
        textLength: text.length,
        tokensUsed: estimatedTokens,
        latencyMs: Date.now() - startMs,
        cacheHit: false,
        path,
      }),
    );

    return c.json(response);
  });

  return app;
}

// Helper functions (internal to route module)
async function extractAllTerms(
  text: string,
): Promise<ExtractResponse["terms"]> {
  const prompt = buildPrompt(text);
  let content = await nimChat([{ role: "user", content: prompt }]);
  try {
    return ExtractResponseSchema.shape.terms.parse(JSON.parse(content));
  } catch (e) {
    // Retry once with error feedback
    content = await nimChat([
      {
        role: "user",
        content: `${prompt}\n\nPrevious output failed JSON parse: ${e}. Return only valid JSON.`,
      },
    ]);
    return ExtractResponseSchema.shape.terms.parse(JSON.parse(content));
  }
}

async function extractSingleTerm(text: string) {
  /* similar, prompt for single term */
}

function buildPrompt(text: string): string {
  /* return full SYSTEM+USER prompt from spec */
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
pnpm --filter=@eduksource/studio test src/routes/extract.test.ts
```

Expected: PASS (tests may need mocks for NIM calls).

- [ ] **Step 6.5: Mount route in `src/index.ts`**

```typescript
// apps/studio/src/index.ts
import { createExtractRoutes } from "./routes/extract.js";
// ...
app.route("/api", createExtractRoutes());
```

- [ ] **Step 6.6: Commit**

```bash
git add apps/studio/src/routes/extract.ts apps/studio/src/routes/extract.test.ts apps/studio/src/index.ts
git commit -m "feat(studio): add PDF extraction route with vision fallback, caching, token budgeting"
```

---

### Task 7: Add Fixture PDFs for Edge Cases

**Files:**

- Create: `apps/studio/tests/fixtures/bow-week-star.pdf` (week: "\*")
- Create: `apps/studio/tests/fixtures/bow-nested-competencies.pdf` (nested bullets)
- Create: `apps/studio/tests/fixtures/bow-large.pdf` (51+ pages, for 413 test)

**Interfaces:** Test fixtures used by vitest.

- [ ] **Step 7.1: Obtain/Generate fixtures**

```bash
# Place real or generated PDFs in apps/studio/tests/fixtures/
# bow-week-star.pdf — contains week "*" entries
# bow-nested-competencies.pdf — deeply nested competency bullets
# bow-large.pdf — 51 pages (or mock in test)
```

- [ ] **Step 7.2: Add tests for each fixture in `extract.test.ts`**

```typescript
// Additional test cases
it("preserves week='*' verbatim", async () => {
  /* use bow-week-star.pdf */
});
it("preserves nested competencies as markdown", async () => {
  /* use bow-nested-competencies.pdf */
});
it("rejects 51-page PDF with 413", async () => {
  /* use bow-large.pdf */
});
it("cache hit skips NIM call", async () => {
  /* upload same file twice */
});
it("returns partial groups + warning on validation failure", async () => {
  /* mock LLM to return invalid groups */
});
```

- [ ] **Step 7.3: Run all tests**

```bash
pnpm --filter=@eduksource/studio test
```

Expected: All PASS.

- [ ] **Step 7.4: Commit**

```bash
git add apps/studio/tests/fixtures/*.pdf apps/studio/src/routes/extract.test.ts
git commit -m "feat(studio): add test fixtures for edge cases (week *, nesting, large files, cache)"
```

---

### Task 8: Add Structured Logging + Env Config

**Files:**

- Modify: `apps/studio/src/config/env.ts` (add `LOG_LEVEL` if needed)
- Modify: `apps/studio/src/routes/extract.ts` (ensure logging)

**Interfaces:** None new.

- [ ] **Step 8.1: Verify structured logs print correctly**

```bash
pnpm --filter=@eduksource/studio dev
# POST a test PDF, check console for JSON log line
```

- [ ] **Step 8.2: Run full test suite**

```bash
pnpm --filter=@eduksource/studio test
pnpm --filter=@eduksource/studio check-types
pnpm format
```

Expected: All PASS, no lint errors.

- [ ] **Step 8.3: Commit**

```bash
git add -A
git commit -m "chore(studio): finalize PDF extraction route, logging, formatting"
```

---

## Spec Coverage Checklist

| Spec Requirement                             | Task       |
| -------------------------------------------- | ---------- |
| `unpdf` primary extraction                   | Task 2     |
| NIM vision fallback for empty/short text     | Tasks 3, 6 |
| File size limit (10 MB)                      | Task 6     |
| Page count limit (50)                        | Task 6     |
| Token budget check + term splitting          | Task 6     |
| JSON parse retry once                        | Task 6     |
| File-hash caching (in-memory)                | Tasks 5, 6 |
| Token usage logging                          | Task 6     |
| `week: "*"` preserved verbatim               | Tasks 4, 7 |
| Nested competencies as markdown              | Tasks 4, 7 |
| Partial validation → warnings + valid groups | Task 6     |
| Tests for all edge cases                     | Task 7     |
| Zod schemas for request/response             | Task 4     |

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-pdf-extraction-route.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
