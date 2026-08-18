# PDF Extraction Route v3 Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise the studio's `POST /api/extract` route (built against the v1 spec in commit `6f6d3db`) to the v3 spec: replace the `terms[]/competencyGroups` shape with a `BowDocument` of `terms[]/blocks[]/strands[]` + `skillsFocus`, add Filipino-aware term splitting, per-block validation, document-level notes, real NIM token-usage logging, and a correct vision fallback that renders PDF pages to images.

**Architecture:** The revision touches the four existing extraction modules (`schemas/extract.ts`, `lib/nim.ts`, `lib/pdf.ts`, `routes/extract.ts`) plus their tests. Schemas are re-authored to v3 shapes; `lib/pdf.ts` gains a page→PNG renderer using `pdfjs-dist` + `@napi-rs/canvas`; `lib/nim.ts` gains `nimChatDetailed` (returns token usage) and a multi-page `nimVisionChat`; the route is rewritten around the new schema with the full v3 system prompt. Structural tests run real fixtures through real `unpdf` extraction with a mocked LLM.

**Tech Stack:** Hono, Zod 4, `unpdf`, `pdfjs-dist` (legacy build), `@napi-rs/canvas` (new dep), OpenAI client, Vitest.

**Spec:** `docs/specs/2026-08-13-pdf-extraction-route-design-v3.md`

## Global Constraints

- Run on Node (not Workers). `@hono/zod-validator`, `unpdf`, `pdfjs-dist` already installed.
- ESM: relative imports use `.js` extensions; `import type` for type-only imports.
- Biome: single quotes, no semicolons, 2-space indent, 100-col. Run `pnpm fix` before finishing each task.
- Tests: Vitest, files next to source. Run `pnpm --filter=@eduksource/studio test <file>`.
- File limits: max 50 pages, max 10 MB (`MAX_PAGES = 50`, `MAX_BYTES = 10*1024*1024`).
- Token budget: estimate `text.length * 1.3`; split by term when > 80% of 128 000-token context.
- Vision fallback triggered when `unpdf` text is empty or < 100 chars, or when `unpdf` throws.
- `NIM_MODEL_OCR` already defined in `src/config/env.ts` (`nvidia/nemotron-ocr-v2`) — no env change needed.
- Fixtures stay **git-tracked** (user decision; deviation from spec §12 "git-ignored").
- User provides five new subject fixture PDFs (Task 5); the two existing fixtures are reused.

---

### Task 0: Create and initialize the worktree

- [ ] **Step 1: Create worktree branch**

```bash
git worktree add .dev/worktrees/pdf-extraction-v3 -b worktree-pdf-extraction-v3
```

- [ ] **Step 2: Initialize worktree**

```bash
pnpm dev:worktree:init
```

Expected: `pnpm install` succeeds, `pnpm build:packages` succeeds (`@eduksource/config` dist exists).

- [ ] **Step 3: Verify tests run in the new worktree**

Run: `pnpm --filter=@eduksource/studio test src/lib/cache.test.ts` (in the worktree)
Expected: PASS (baseline before changes).

---

### Task 1: Upgrade Zod schemas to v3 `BowDocument` structure

**Files:**

- Rewrite: `apps/studio/src/schemas/extract.ts`
- Rewrite: `apps/studio/src/schemas/extract.test.ts`
- Modify: `apps/studio/src/lib/cache.test.ts` (payload literals gain `document` field)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `SkillsFocusItemSchema`, `SkillsFocusSchema`, `BowStrandSchema`, `BowBlockSchema`, `BowTermSchema`, `BowDocumentSchema`, `ExtractResponseSchema` and inferred types `SkillsFocusItem`, `SkillsFocus`, `BowStrand`, `BowBlock`, `BowTerm`, `BowDocument`, `ExtractResponse`. `BowBlockSchema` is used for block-level validation in Task 4; `BowDocumentSchema` for LLM response parsing in Task 4.

- [ ] **Step 1: Rewrite the schema test file (failing first)**

Write `apps/studio/src/schemas/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  type BowBlock,
  type BowDocument,
  type BowStrand,
  type BowTerm,
  BowBlockSchema,
  BowDocumentSchema,
  type ExtractResponse,
  ExtractResponseSchema,
} from './extract.js'

describe('extract v3 schemas', () => {
  const validDocument = {
    learningArea: 'General Mathematics',
    gradeLevel: 'Grade 11',
    documentNotes: '2 hours per week',
    terms: [
      {
        termLabel: 'First Term',
        contentStandard: ['CS 1', 'CS 2'],
        performanceStandard: ['PS 1'],
        skillsFocus: {
          sourceLabel: 'Essential Life Skills',
          items: [{ text: 'Critical thinking', gloss: null }],
        },
        suggestedActivities: ['Activity 1'],
        suggestedPerformanceTasks: null,
        blocks: [
          {
            weekLabel: '1 to 2 (10 days)',
            durationDays: 10,
            contentStandard: ['Block CS'],
            performanceStandard: null,
            skillsFocus: null,
            strands: [
              { strandLabel: 'Geometry', topicLabel: 'Circles', competenciesRaw: '- Draw\n  - Label' },
              { strandLabel: 'Algebra', topicLabel: null, competenciesRaw: '- Solve' },
            ],
            extractionNotes: null,
          },
        ],
      },
    ],
  }

  it('parses a full valid BowDocument', () => {
    expect(BowDocumentSchema.parse(validDocument)).toEqual(validDocument)
  })

  it('preserves week "*" and range labels verbatim with durationDays', () => {
    const block = BowBlockSchema.parse({
      weekLabel: '*',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    })
    expect(block.weekLabel).toBe('*')
    const range = BowBlockSchema.parse({
      weekLabel: '1 to 2 (10 days)',
      durationDays: 10,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    })
    expect(range.weekLabel).toBe('1 to 2 (10 days)')
    expect(range.durationDays).toBe(10)
  })

  it('captures multiple content standard entries as separate array items', () => {
    const doc = BowDocumentSchema.parse(validDocument)
    expect(doc.terms[0].contentStandard).toEqual(['CS 1', 'CS 2'])
  })

  it('keeps per-block content standard on the block, term-level stays null', () => {
    const block = BowBlockSchema.parse({
      weekLabel: '1',
      durationDays: null,
      contentStandard: ['Block CS'],
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    })
    expect(block.contentStandard).toEqual(['Block CS'])
    const term = BowTermSchema.parse({
      termLabel: 'First Term',
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      blocks: [block],
      suggestedActivities: null,
      suggestedPerformanceTasks: null,
    })
    expect(term.contentStandard).toBeNull()
  })

  it('supports skillsFocus with gloss and as plain list', () => {
    expect(BowDocumentSchema.parse({ ...validDocument, terms: [] })).toBeTruthy()
    const focus = validDocument.terms[0].skillsFocus
    expect(focus.items[0].gloss).toBeNull()
    expect(focus.sourceLabel).toBe('Essential Life Skills')
  })

  it('allows two strands in a single block', () => {
    const doc = BowDocumentSchema.parse(validDocument)
    expect(doc.terms[0].blocks[0].strands).toHaveLength(2)
  })

  it('rejects a block with zero strands', () => {
    expect(() =>
      BowBlockSchema.parse({
        weekLabel: '1',
        durationDays: null,
        contentStandard: null,
        performanceStandard: null,
        skillsFocus: null,
        strands: [],
        extractionNotes: null,
      })
    ).toThrow()
  })

  it('rejects a document missing required fields', () => {
    expect(() => ExtractResponseSchema.parse({ text: 'x', pages: 1 })).toThrow()
    expect(() => BowDocumentSchema.parse({})).toThrow()
  })

  it('infers v3 types', () => {
    const response: ExtractResponse = {
      text: 'x',
      pages: 1,
      document: validDocument,
      warnings: [],
      notes: [],
    }
    expect(response.document.terms[0].blocks[0].strands[0].strandLabel).toBe('Geometry')
    const block: BowBlock = response.document.terms[0].blocks[0]
    const strand: BowStrand = block.strands[0]
    const term: BowTerm = response.document.terms[0]
    const doc: BowDocument = response.document
    expect(strand.competenciesRaw).toContain('Label')
    expect(term.termLabel).toBe('First Term')
    expect(doc.learningArea).toBe('General Mathematics')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@eduksource/studio test src/schemas/extract.test.ts`
Expected: FAIL — `BowDocumentSchema` is not exported (module errors).

- [ ] **Step 3: Rewrite `src/schemas/extract.ts`**

```ts
import { z } from 'zod'

export const SkillsFocusItemSchema = z.object({
  text: z.string(),
  gloss: z.string().nullable(),
})

export const SkillsFocusSchema = z.object({
  sourceLabel: z.string(),
  items: z.array(SkillsFocusItemSchema).min(1),
})

export const BowStrandSchema = z.object({
  strandLabel: z.string().nullable(),
  topicLabel: z.string().nullable(),
  competenciesRaw: z.string(),
})

export const BowBlockSchema = z.object({
  weekLabel: z.string(), // verbatim: "*", "1 to 2 (10 days)", "Linggo 1"
  durationDays: z.number().int().positive().nullable(), // only if explicitly stated
  contentStandard: z.array(z.string()).nullable(),
  performanceStandard: z.array(z.string()).nullable(),
  skillsFocus: SkillsFocusSchema.nullable(),
  strands: z.array(BowStrandSchema).min(1),
  extractionNotes: z.string().nullable(),
})

export const BowTermSchema = z.object({
  termLabel: z.string(), // verbatim, source language: "First Term" | "Unang Termino"
  contentStandard: z.array(z.string()).nullable(),
  performanceStandard: z.array(z.string()).nullable(),
  skillsFocus: SkillsFocusSchema.nullable(),
  suggestedActivities: z.array(z.string()).nullable(),
  suggestedPerformanceTasks: z.array(z.string()).nullable(),
  blocks: z.array(BowBlockSchema),
})

export const BowDocumentSchema = z.object({
  learningArea: z.string(),
  gradeLevel: z.string(),
  documentNotes: z.string().nullable(),
  terms: z.array(BowTermSchema),
})

export const ExtractResponseSchema = z.object({
  text: z.string(),
  pages: z.number().int().nonnegative(),
  document: BowDocumentSchema,
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
})

export type SkillsFocusItem = z.infer<typeof SkillsFocusItemSchema>
export type SkillsFocus = z.infer<typeof SkillsFocusSchema>
export type BowStrand = z.infer<typeof BowStrandSchema>
export type BowBlock = z.infer<typeof BowBlockSchema>
export type BowTerm = z.infer<typeof BowTermSchema>
export type BowDocument = z.infer<typeof BowDocumentSchema>
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>
```

- [ ] **Step 4: Update `src/lib/cache.test.ts` payloads**

Replace every `{ text: 'x', pages: 1, terms: [], warnings: [], notes: [] }`-style literal (lines 9, 32, 41 — three occurrences) with:

```ts
{
  text: 'x',
  pages: 1,
  document: { learningArea: '', gradeLevel: '', documentNotes: null, terms: [] },
  warnings: [],
  notes: [],
}
```

(`cache.ts` itself needs no edit — it only references the `ExtractResponse` type.)

- [ ] **Step 5: Run schema and cache tests**

Run: `pnpm --filter=@eduksource/studio test src/schemas/extract.test.ts src/lib/cache.test.ts`
Expected: PASS.

- [ ] **Step 6: Run `pnpm fix` and check types**

Run: `pnpm --filter=@eduksource/studio fix` then `pnpm --filter=@eduksource/studio check-types`
Expected: no errors. (`check-types` may report errors in `routes/extract.ts`/`routes/extract.test.ts` from the shape change — that is expected until Task 4; verify errors are confined to those two files.)

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/schemas/extract.ts apps/studio/src/schemas/extract.test.ts apps/studio/src/lib/cache.test.ts
git commit -m "refactor(studio): upgrade BOW schema to v3 document structure (blocks, strands, skillsFocus)"
```

---

### Task 2: Add NIM usage metadata and multi-page vision chat

**Files:**

- Modify: `apps/studio/src/lib/nim.ts`
- Rewrite: `apps/studio/src/lib/nim.test.ts`

**Interfaces:**

- Consumes: `env` (existing), OpenAI client (existing).
- Produces:
  - `export type NimUsage = { input: number; output: number }`
  - `export async function nimChatDetailed(messages, opts?): Promise<{ content: string | null; usage: NimUsage }>` — same request shape as `nimChat`, but also returns prompt/completion token counts from response metadata.
  - `export async function nimVisionChat(pages: string[], prompt: string): Promise<string>` — **signature changed** from `(imageBase64: string, prompt: string)`; `pages` is an array of base64 PNG strings, each sent as an `image_url` content part.
- `nimChat`, `nimChatStream`, `nimChatStreamText` stay unchanged (used by `health.ts`).

- [ ] **Step 1: Rewrite `src/lib/nim.test.ts` (failing first)**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  }
  return { default: MockOpenAI }
})

import { nimChatDetailed, nimVisionChat } from './nim.js'

describe('nimChatDetailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns content and usage metadata', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
    })

    const result = await nimChatDetailed([{ role: 'user', content: 'hi' }])

    expect(result.content).toBe('{"ok":true}')
    expect(result.usage).toEqual({ input: 120, output: 45 })
  })

  it('returns null content and zero usage when absent', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: undefined,
    })

    const result = await nimChatDetailed([{ role: 'user', content: 'hi' }])
    expect(result.content).toBeNull()
    expect(result.usage).toEqual({ input: 0, output: 0 })
  })
})

describe('nimVisionChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends every page as an image_url part', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Extracted text from image' } }],
    })

    const result = await nimVisionChat(['img1', 'img2'], 'Extract text')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract text' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,img2' } },
            ],
          },
        ],
        temperature: 0.1,
        max_completion_tokens: 8192,
      })
    )
    expect(result).toBe('Extracted text from image')
  })

  it('returns empty string when no content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    })
    const result = await nimVisionChat(['img'], 'Extract text')
    expect(result).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@eduksource/studio test src/lib/nim.test.ts`
Expected: FAIL — `nimChatDetailed` not exported; `nimVisionChat` called with array.

- [ ] **Step 3: Modify `src/lib/nim.ts`**

Add after `nimChat` (keep `nimChat`, `nimChatStream`, `nimChatStreamText` untouched):

```ts
export type NimUsage = { input: number; output: number }

export async function nimChatDetailed(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel }
): Promise<{ content: string | null; usage: NimUsage }> {
  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: baseURL,
  })

  const completion = await openai.chat.completions.create({
    ...opts,
    model: opts.model,
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: opts.max_completion_tokens ?? 8192,
    top_p: opts.top_p ?? 0.95,
    stream: false,
  })

  return {
    content: completion.choices[0]?.message.content ?? null,
    usage: {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
    },
  }
}
```

Replace the existing `nimVisionChat` with the multi-page version:

```ts
export async function nimVisionChat(pages: string[], prompt: string): Promise<string> {
  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: baseURL,
  })

  const completion = await openai.chat.completions.create({
    model: ocrModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...pages.map((b64) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 8192,
  })

  return completion.choices[0]?.message.content ?? ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@eduksource/studio test src/lib/nim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/lib/nim.ts apps/studio/src/lib/nim.test.ts
git commit -m "feat(studio): add NIM usage metadata and multi-page vision chat"
```

---

### Task 3: Render PDF pages to PNG images for the OCR fallback

**Files:**

- Modify: `apps/studio/package.json` (add `@napi-rs/canvas`)
- Modify: `apps/studio/src/lib/pdf.ts`
- Modify: `apps/studio/src/lib/pdf.test.ts`

**Interfaces:**

- Consumes: `pdfjs-dist/legacy/build/pdf.mjs` (already a dependency).
- Produces:
  - `export class TooManyPagesError extends Error` — thrown when a PDF has more pages than the caller's `maxPages`.
  - `export async function pdfPagesToPngs(file: Uint8Array, maxPages: number): Promise<string[]>` — returns base64-encoded PNG strings, one per page.

- [ ] **Step 1: Install the canvas dependency**

Run: `pnpm --filter=@eduksource/studio add @napi-rs/canvas`
Expected: adds `"@napi-rs/canvas"` to `apps/studio/package.json` dependencies.

- [ ] **Step 2: Extend `src/lib/pdf.test.ts` (failing first)**

Append:

```ts
import { TooManyPagesError, pdfPagesToPngs } from './pdf.js'

describe('pdfPagesToPngs', () => {
  it('renders every page of the English fixture to base64 PNGs', async () => {
    const fixture = new Uint8Array(
      await readFile(join(__dirname, '..', '..', 'tests', 'fixtures', 'BOW-[G7]-English.pdf'))
    )
    const images = await pdfPagesToPngs(fixture, 50)
    expect(images.length).toBe(8)
    expect(images[0]).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(images[0].length).toBeGreaterThan(100)
  })

  it('throws TooManyPagesError when the document exceeds maxPages', async () => {
    const fixture = new Uint8Array(
      await readFile(join(__dirname, '..', '..', 'tests', 'fixtures', 'BOW-[G7]-English.pdf'))
    )
    await expect(pdfPagesToPngs(fixture, 1)).rejects.toThrow(TooManyPagesError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter=@eduksource/studio test src/lib/pdf.test.ts`
Expected: FAIL — `TooManyPagesError`/`pdfPagesToPngs` not exported.

- [ ] **Step 4: Extend `src/lib/pdf.ts`**

Append to the existing file (keep `extractText` as-is):

```ts
import { Canvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export class TooManyPagesError extends Error {
  constructor(maxPages: number) {
    super(`Too many pages (max ${maxPages})`)
    this.name = 'TooManyPagesError'
  }
}

type PdfCanvasContext = import('pdfjs-dist').RenderParameters['canvasContext']

export async function pdfPagesToPngs(file: Uint8Array, maxPages: number): Promise<string[]> {
  const doc = await getDocument({ data: file }).promise
  try {
    const pageCount = doc.numPages
    if (pageCount > maxPages) {
      throw new TooManyPagesError(maxPages)
    }

    const images: string[] = []
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = new Canvas(viewport.width, viewport.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx as PdfCanvasContext, viewport }).promise
      images.push(canvas.toDataURL('image/png').split(',')[1] ?? '')
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
    return images
  } finally {
    await doc.destroy()
  }
}
```

Note: `ctx as PdfCanvasContext` exists because `@napi-rs/canvas`'s 2D context type is not structurally identical to the DOM `CanvasRenderingContext2D` that pdfjs's render types expect, while being runtime-compatible.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter=@eduksource/studio test src/lib/pdf.test.ts`
Expected: PASS (rendering 8 pages; PNG data is base64). If `page.render` typing fights back, cast the whole param `page.render({ canvasContext: ctx as never, viewport })` — the runtime contract is what matters.

- [ ] **Step 6: Run `pnpm fix` and check types**

Run: `pnpm --filter=@eduksource/studio fix` then `pnpm --filter=@eduksource/studio check-types`
Expected: no new errors beyond the known Task-4 pending ones in `routes/*`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/package.json apps/studio/src/lib/pdf.ts apps/studio/src/lib/pdf.test.ts
git commit -m "feat(studio): render PDF pages to PNG images for NIM OCR fallback"
```

---

### Task 4: Rewrite the extract route for the v3 schema

**Files:**

- Rewrite: `apps/studio/src/routes/extract.ts`
- Rewrite: `apps/studio/src/routes/extract.test.ts`

**Interfaces:**

- Consumes: `nimChatDetailed`, `nimVisionChat`, `NimUsage` (Task 2); `extractText`, `pdfPagesToPngs`, `TooManyPagesError` (Task 3); `BowDocumentSchema`, `BowBlockSchema`, `BowDocument`, `BowTerm`, `ExtractResponse` (Task 1); `extractionCache` (existing).
- Produces: `createExtractRoutes()` returning the same `POST /extract` handler, mounted at `/api` in `index.ts` (no change to `index.ts`).

Flow implemented: MIME check → size 413 → hash + cache hit → `extractText` (fallback on throw) → pages 413 → short/empty → page-render vision fallback (413 on `TooManyPagesError`, 500 on failure) → empty short-circuit → `extractDocument` (token budget split incl. Filipino terms, single parse + one retry, 500 with raw output if retry fails) → block-level validation with per-block omit + warning → aggregate `extractionNotes` into `notes` → cache → structured log with `{ fileHash, pages, textLength, tokensUsed: {input, output}, latencyMs, cacheHit, path, learningArea, termCount }`.

- [ ] **Step 1: Rewrite `src/routes/extract.test.ts` (failing first)**

```ts
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BowDocument, ExtractResponse } from '../schemas/extract.js'

const { mockedNimChatDetailed, mockedNimVisionChat } = vi.hoisted(() => ({
  mockedNimChatDetailed: vi.fn(),
  mockedNimVisionChat: vi.fn(),
}))

const { mockedExtractText, mockedPdfPagesToPngs, mockedTooManyPagesError } = vi.hoisted(() => ({
  mockedExtractText: vi.fn(),
  mockedPdfPagesToPngs: vi.fn(),
  mockedTooManyPagesError: class TooManyPagesError extends Error {},
}))

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    hashFile: vi.fn(),
  },
}))

vi.mock('../lib/nim.js', () => ({
  nimChatDetailed: mockedNimChatDetailed,
  nimVisionChat: mockedNimVisionChat,
}))

vi.mock('../lib/pdf.js', () => ({
  extractText: mockedExtractText,
  pdfPagesToPngs: mockedPdfPagesToPngs,
  TooManyPagesError: mockedTooManyPagesError,
}))

vi.mock('../lib/cache.js', () => ({
  extractionCache: mockedExtractionCache,
}))

import { createExtractRoutes } from './extract.js'

const validDoc: BowDocument = {
  learningArea: 'English',
  gradeLevel: 'Grade 7',
  documentNotes: null,
  terms: [
    {
      termLabel: 'First Term',
      contentStandard: ['CS'],
      performanceStandard: ['PS'],
      skillsFocus: null,
      suggestedActivities: null,
      suggestedPerformanceTasks: null,
      blocks: [
        {
          weekLabel: '1',
          durationDays: null,
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          strands: [{ strandLabel: null, topicLabel: 'Topic', competenciesRaw: '- Competency' }],
          extractionNotes: null,
        },
      ],
    },
  ],
}

function pdfForm(): FormData {
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(1000)], { type: 'application/pdf' }), 'test.pdf')
  return formData
}

function mockChatOk(overrides: Partial<BowDocument> = {}): void {
  mockedNimChatDetailed.mockResolvedValue({
    content: JSON.stringify({ ...validDoc, ...overrides }),
    usage: { input: 120, output: 45 },
  })
}

describe('POST /api/extract', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api', createExtractRoutes())
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-PDF with 400', async () => {
    const formData = new FormData()
    formData.append('file', new Blob(['not pdf'], { type: 'text/plain' }), 'test.txt')
    const res = await app.request('/api/extract', { method: 'POST', body: formData })
    expect(res.status).toBe(400)
  })

  it('rejects oversized file with 413', async () => {
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'application/pdf' }), 'big.pdf')
    const res = await app.request('/api/extract', { method: 'POST', body: formData })
    expect(res.status).toBe(413)
  })

  it('returns 413 for PDF with >50 pages', async () => {
    mockedExtractText.mockResolvedValue({ text: 'test', pages: 51 })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(413)
  })

  it('uses vision fallback when unpdf returns short text', async () => {
    mockChatOk()
    mockedExtractText.mockResolvedValue({ text: 'short', pages: 1 })
    mockedPdfPagesToPngs.mockResolvedValue(['img1'])
    mockedNimVisionChat.mockResolvedValue('Extracted via vision')
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    expect(mockedPdfPagesToPngs).toHaveBeenCalledWith(expect.any(Uint8Array), 50)
    expect(mockedNimVisionChat).toHaveBeenCalledWith(['img1'], expect.any(String))
  })

  it('falls back to vision when unpdf throws', async () => {
    mockChatOk()
    mockedExtractText.mockRejectedValue(new Error('unpdf exploded'))
    mockedPdfPagesToPngs.mockResolvedValue(['img1'])
    mockedNimVisionChat.mockResolvedValue('OCR text from pages')
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    expect(mockedNimVisionChat).toHaveBeenCalled()
  })

  it('returns 413 when rendered PDF exceeds page limit', async () => {
    mockedExtractText.mockRejectedValue(new Error('x'))
    mockedPdfPagesToPngs.mockRejectedValue(new mockedTooManyPagesError(50))
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(413)
  })

  it('returns 500 when unpdf and vision both fail', async () => {
    mockedExtractText.mockRejectedValue(new Error('unpdf exploded'))
    mockedPdfPagesToPngs.mockRejectedValue(new Error('render failed'))
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(500)
  })

  it('returns a graceful empty document for an empty PDF', async () => {
    mockedExtractText.mockResolvedValue({ text: '', pages: 1 })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExtractResponse
    expect(body.document.terms).toEqual([])
    expect(mockedNimChatDetailed).not.toHaveBeenCalled()
  })

  it('retries once on JSON parse failure then succeeds', async () => {
    mockedNimChatDetailed
      .mockResolvedValueOnce({ content: 'invalid json {', usage: { input: 1, output: 1 } })
      .mockResolvedValueOnce({ content: JSON.stringify(validDoc), usage: { input: 2, output: 2 } })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(2)
  })

  it('returns 500 with raw output after retry still fails', async () => {
    mockedNimChatDetailed
      .mockResolvedValueOnce({ content: 'invalid json {', usage: { input: 1, output: 1 } })
      .mockResolvedValueOnce({ content: 'still invalid {', usage: { input: 1, output: 1 } })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.raw).toBe('still invalid {')
  })

  it('caches result and skips NIM on second upload', async () => {
    mockChatOk()
    const res1 = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res1.status).toBe(200)
    mockedExtractionCache.get.mockReturnValue({ text: 'cached', pages: 1, document: validDoc, warnings: [], notes: [] })
    const res2 = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res2.status).toBe(200)
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(1)
  })

  it('splits by term when text exceeds the token budget', async () => {
    mockedExtractText.mockResolvedValue({
      text: 'First Term ' + 'A'.repeat(40_000) + ' Second Term ' + 'B'.repeat(40_000),
      pages: 1,
    })
    mockedNimChatDetailed
      .mockResolvedValueOnce({
        content: JSON.stringify({ ...validDoc, learningArea: 'Math', terms: [validDoc.terms[0]] }),
        usage: { input: 100, output: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...validDoc,
          learningArea: '',
          terms: [{ ...validDoc.terms[0], termLabel: 'Second Term' }],
        }),
        usage: { input: 90, output: 8 },
      })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(2)
    const body = (await res.json()) as ExtractResponse
    expect(body.document.terms.map((t) => t.termLabel)).toEqual(['First Term', 'Second Term'])
    expect(body.document.learningArea).toBe('Math')
  })

  it('omits invalid blocks and returns valid blocks plus a warning', async () => {
    const badBlock = {
      weekLabel: '2',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [], // violates min(1)
      extractionNotes: null,
    }
    mockedNimChatDetailed.mockResolvedValue({
      content: JSON.stringify({
        ...validDoc,
        terms: [{ ...validDoc.terms[0], blocks: [validDoc.terms[0].blocks[0], badBlock] }],
      }),
      usage: { input: 120, output: 45 },
    })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExtractResponse
    expect(body.document.terms[0].blocks).toHaveLength(1)
    expect(body.warnings.join(' ')).toContain('1 competency blocks omitted')
  })

  it('aggregates extractionNotes from blocks into the notes array', async () => {
    mockedNimChatDetailed.mockResolvedValue({
      content: JSON.stringify({
        ...validDoc,
        terms: [
          {
            ...validDoc.terms[0],
            blocks: [{ ...validDoc.terms[0].blocks[0], extractionNotes: 'Run-together artifact at "sentencehere"' }],
          },
        ],
      }),
      usage: { input: 120, output: 45 },
    })
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() })
    const body = (await res.json()) as ExtractResponse
    expect(body.notes).toContain('Run-together artifact at "sentencehere"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@eduksource/studio test src/routes/extract.test.ts`
Expected: FAIL — `nimChatDetailed` unused by the old route; payload shapes mismatch; import errors.

- [ ] **Step 3: Rewrite `src/routes/extract.ts`**

```ts
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { extractionCache } from '../lib/cache.js'
import { nimChatDetailed, nimVisionChat, type NimUsage } from '../lib/nim.js'
import { extractText, pdfPagesToPngs, TooManyPagesError } from '../lib/pdf.js'
import {
  type BowDocument,
  type BowTerm,
  BowBlockSchema,
  BowDocumentSchema,
  type ExtractResponse,
} from '../schemas/extract.js'

const MAX_PAGES = 50
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const TOKEN_ESTIMATE_FACTOR = 1.3
const TOKEN_BUDGET_RATIO = 0.8
const CONTEXT_WINDOW = 128_000 // NIM model context window
const MIN_TEXT_FOR_UNPDF = 100

const FileUploadSchema = z.object({
  file: z.instanceof(File).refine((f) => f.type === 'application/pdf', 'Must be PDF'),
})

const SCHEMA_JSON = `{
  "learningArea": "string",
  "gradeLevel": "string",
  "documentNotes": "string | null",
  "terms": [
    {
      "termLabel": "string",
      "contentStandard": ["string"] | null,
      "performanceStandard": ["string"] | null,
      "skillsFocus": {
        "sourceLabel": "string",
        "items": [{ "text": "string", "gloss": "string | null" }]
      } | null,
      "suggestedActivities": ["string"] | null,
      "suggestedPerformanceTasks": ["string"] | null,
      "blocks": [
        {
          "weekLabel": "string",
          "durationDays": "number | null",
          "contentStandard": ["string"] | null,
          "performanceStandard": ["string"] | null,
          "skillsFocus": {
            "sourceLabel": "string",
            "items": [{ "text": "string", "gloss": "string | null" }]
          } | null,
          "strands": [
            {
              "strandLabel": "string | null",
              "topicLabel": "string | null",
              "competenciesRaw": "string"
            }
          ],
          "extractionNotes": "string | null"
        }
      ]
    }
  ]
}`

function buildSystemPrompt(): string {
  return `You are extracting structured curriculum data from a Philippine DepEd Budget of Work (BOW)
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
${SCHEMA_JSON}`
}

function buildUserPrompt(extractedText: string): string {
  return `Extract structured data from the following BOW document text:

${extractedText}`
}

function splitByTerm(text: string): string[] {
  const sections = text
    .split(
      /(?=First Term|Second Term|Third Term|Unang Termino|Ikalawang Termino|Ikatlong Termino)/i
    )
    .filter(Boolean)
  return sections.length > 0 ? sections : [text]
}

class ExtractionParseError extends Error {
  raw: string
  constructor(raw: string, message: string) {
    super(message)
    this.name = 'ExtractionParseError'
    this.raw = raw
  }
}

async function extractBowDocument(
  text: string
): Promise<{ document: BowDocument; usage: NimUsage }> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(text)

  let { content, usage } = await nimChatDetailed([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  try {
    const document = BowDocumentSchema.parse(JSON.parse(content ?? ''))
    return { document, usage }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown parse error'
    const retry = await nimChatDetailed([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${userPrompt}\n\nPrevious output failed JSON parse: ${errorMsg}. Return only valid JSON.`,
      },
    ])
    try {
      const document = BowDocumentSchema.parse(JSON.parse(retry.content ?? ''))
      return { document, usage: retry.usage }
    } catch (retryErr) {
      throw new ExtractionParseError(
        retry.content ?? '',
        `Failed to parse LLM output: ${retryErr instanceof Error ? retryErr.message : 'Unknown'}`
      )
    }
  }
}

function mergeUsage(...usages: NimUsage[]): NimUsage {
  return usages.reduce(
    (acc, u) => ({ input: acc.input + u.input, output: acc.output + u.output }),
    { input: 0, output: 0 }
  )
}

async function extractDocument(
  text: string
): Promise<{ document: BowDocument; usage: NimUsage }> {
  const estimatedTokens = Math.ceil(text.length * TOKEN_ESTIMATE_FACTOR)
  const maxTokens = Math.floor(CONTEXT_WINDOW * TOKEN_BUDGET_RATIO)

  if (estimatedTokens <= maxTokens) {
    return extractBowDocument(text)
  }

  const sections = splitByTerm(text)
  const usages: NimUsage[] = []
  const terms: BowTerm[] = []
  let learningArea = ''
  let gradeLevel = ''
  let documentNotes: string | null = null

  for (const section of sections) {
    const { document, usage } = await extractBowDocument(section)
    usages.push(usage)
    terms.push(...document.terms)
    learningArea ||= document.learningArea
    gradeLevel ||= document.gradeLevel
    documentNotes ??= document.documentNotes
  }

  return {
    document: { learningArea, gradeLevel, documentNotes, terms },
    usage: mergeUsage(...usages),
  }
}

function validateDocument(document: BowDocument): {
  document: BowDocument
  warnings: string[]
  notes: string[]
} {
  const warnings: string[] = []
  const notes: string[] = []
  let totalBlocks = 0
  let omittedBlocks = 0

  const terms = document.terms.map((term) => ({
    ...term,
    blocks: term.blocks.filter((block) => {
      totalBlocks++
      const parsed = BowBlockSchema.safeParse(block)
      if (parsed.success) {
        if (block.extractionNotes) notes.push(block.extractionNotes)
        return true
      }
      omittedBlocks++
      warnings.push(
        `Competency block validation failed (week ${block.weekLabel}): ${parsed.error.message}`
      )
      return false
    }),
  }))

  if (omittedBlocks > 0) {
    warnings.push(`${omittedBlocks} competency blocks omitted due to validation failure`)
  }

  return { document: { ...document, terms }, warnings, notes }
}

export function createExtractRoutes() {
  const app = new Hono()

  app.post('/extract', zValidator('form', FileUploadSchema), async (c) => {
    const startMs = Date.now()
    const { file } = c.req.valid('form')

    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large (max 10 MB)' }, 413)
    }

    const buffer = new Uint8Array(await file.arrayBuffer())
    const fileHash = await extractionCache.hashFile(buffer)

    const cached = extractionCache.get(fileHash)
    if (cached) {
      console.log(
        JSON.stringify({ fileHash, cacheHit: true, path: 'cache', latencyMs: Date.now() - startMs })
      )
      return c.json(cached)
    }

    let text = ''
    let pages = 0
    let path: 'unpdf' | 'vision-fallback' = 'unpdf'

    try {
      const result = await extractText(buffer)
      text = result.text
      pages = result.pages
    } catch {
      path = 'vision-fallback'
    }

    if (pages > MAX_PAGES) {
      return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413)
    }

    if (!text || text.length < MIN_TEXT_FOR_UNPDF) {
      path = 'vision-fallback'
      try {
        const pageImages = await pdfPagesToPngs(buffer, MAX_PAGES)
        text = await nimVisionChat(pageImages, 'Extract all text from this BOW document. Return raw text only.')
      } catch (err) {
        if (err instanceof TooManyPagesError) {
          return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413)
        }
        console.log(
          JSON.stringify({
            fileHash,
            error: err instanceof Error ? err.message : 'unknown',
            path: 'vision-fallback',
          })
        )
        return c.json({ error: 'Failed to extract text from PDF' }, 500)
      }
    }

    if (!text.trim()) {
      const emptyResponse: ExtractResponse = {
        text,
        pages,
        document: { learningArea: '', gradeLevel: '', documentNotes: null, terms: [] },
        warnings: [],
        notes: [],
      }
      extractionCache.set(fileHash, emptyResponse)
      return c.json(emptyResponse)
    }

    let document: BowDocument
    let usage: NimUsage
    try {
      const result = await extractDocument(text)
      document = result.document
      usage = result.usage
    } catch (err) {
      if (err instanceof ExtractionParseError) {
        return c.json({ error: err.message, raw: err.raw }, 500)
      }
      throw err
    }

    const { document: validated, warnings, notes } = validateDocument(document)

    const response: ExtractResponse = { text, pages, document: validated, warnings, notes }

    extractionCache.set(fileHash, response)

    console.log(
      JSON.stringify({
        fileHash,
        pages,
        textLength: text.length,
        tokensUsed: usage,
        latencyMs: Date.now() - startMs,
        cacheHit: false,
        path,
        learningArea: validated.learningArea,
        termCount: validated.terms.length,
      })
    )

    return c.json(response)
  })

  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter=@eduksource/studio test src/routes/extract.test.ts`
Expected: PASS (all 13 control-flow tests).

- [ ] **Step 5: Run `pnpm fix` and `check-types`**

Run: `pnpm --filter=@eduksource/studio fix` then `pnpm --filter=@eduksource/studio check-types`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/routes/extract.ts apps/studio/src/routes/extract.test.ts
git commit -m "feat(studio): revise extract route for v3 BOW schema with richer prompt and block validation"
```

---

### Task 5: Structural pattern tests across subject BOW fixtures

**Files:**

- Create (user-provided PDFs): `apps/studio/tests/fixtures/bow-mapeh.pdf`, `bow-mathematics.pdf`, `bow-science.pdf`, `bow-life-career-skills.pdf`, `bow-araling-panlipunan.pdf` (English/Values Ed already present).
- Create: `apps/studio/src/routes/extract.patterns.test.ts`

**Interfaces:**

- Consumes: `createExtractRoutes()` (Task 4); real `extractText` from `lib/pdf.js`; mocked `nimChatDetailed`/`extractionCache`.

Fixture → pattern mapping (user-provided PDFs must match these):

| Fixture | Patterns asserted |
| --- | --- |
| `BOW-[G7]-English.pdf` (exists) | week `"*"` preserved verbatim |
| `BOW-[G10]-Values Education-Three-Term.pdf` (exists) | content/performance standard per-block, not duplicated on term; `skillsFocus` `"Values to be Developed"` with gloss |
| `bow-mapeh.pdf` | one week block with two labeled strands (Music and Arts + PE and Health); `documentNotes` holds time-allocation note |
| `bow-mathematics.pdf` | week range `"1 to 2 (10 days)"` + `durationDays: 10`; two strands (Geometry + Algebra); `learningArea` from header text, not filename |
| `bow-science.pdf` | content/performance standard as multi-entry arrays; term-level `suggestedActivities` + `suggestedPerformanceTasks` |
| `bow-life-career-skills.pdf` | `competenciesRaw` with 5+ nesting levels; `skillsFocus` `"Essential Life Skills"` list, multiple items, `gloss: null` |
| `bow-araling-panlipunan.pdf` | Filipino labels (`"Linggo"`, `"Kasanayang Pampagkatuto"`, `"Unang Termino"`) preserved verbatim; prompt wiring includes Filipino mapping |

- [ ] **Step 1: Obtain the five fixture PDFs from the user**

Place the five PDFs named above in `apps/studio/tests/fixtures/`. Verify each exists and is a real PDF:

Run: `file apps/studio/tests/fixtures/bow-*.pdf`
Expected: every file reports `PDF document`. If any is missing, stop and ask the user for it.

- [ ] **Step 2: Write `src/routes/extract.patterns.test.ts` (failing first)**

```ts
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractResponse } from '../schemas/extract.js'

const { mockedNimChatDetailed } = vi.hoisted(() => ({
  mockedNimChatDetailed: vi.fn(),
}))

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: { get: vi.fn(), set: vi.fn(), hashFile: vi.fn() },
}))

vi.mock('../lib/nim.js', () => ({
  nimChatDetailed: mockedNimChatDetailed,
  nimVisionChat: vi.fn(),
}))

vi.mock('../lib/cache.js', () => ({
  extractionCache: mockedExtractionCache,
}))

// NOTE: lib/pdf.js is intentionally NOT mocked — real unpdf extraction runs on real fixtures.

import { createExtractRoutes } from './extract.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = (name: string) => join(__dirname, '..', '..', 'tests', 'fixtures', name)

async function postFixture(app: Hono, name: string): Promise<Response> {
  const bytes = await readFile(fixturePath(name))
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'bow.pdf')
  return app.request('/api/extract', { method: 'POST', body: formData })
}

function mockDoc(overrides: Partial<ExtractResponse['document']> = {}): void {
  mockedNimChatDetailed.mockResolvedValue({
    content: JSON.stringify({
      learningArea: 'Subject',
      gradeLevel: 'Grade 7',
      documentNotes: null,
      terms: [],
      ...overrides,
    }),
    usage: { input: 120, output: 45 },
  })
}

describe('POST /api/extract — structural patterns', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api', createExtractRoutes())
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash-fixture')
    mockDoc()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('extracts real text from the English fixture and passes it to NIM', async () => {
    await postFixture(app, 'BOW-[G7]-English.pdf')
    const call = mockedNimChatDetailed.mock.calls[0][0] as Array<{ role: string; content: string }>
    const userMsg = call.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('First Term')
  })

  it('preserves week "*" verbatim (English fixture)', async () => {
    mockDoc({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: ['CS'],
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '*',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'BOW-[G7]-English.pdf')
    const body = (await res.json()) as ExtractResponse
    expect(body.document.terms[0].blocks[0].weekLabel).toBe('*')
  })

  it('keeps per-block content standard and skillsFocus gloss (Values Education fixture)', async () => {
    mockDoc({
      learningArea: 'Values Education',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: ['Block-level CS'],
              performanceStandard: ['Block-level PS'],
              skillsFocus: {
                sourceLabel: 'Values to be Developed',
                items: [{ text: 'Honesty', gloss: 'paglalahad ng katotohanan' }],
              },
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'BOW-[G10]-Values Education-Three-Term.pdf')
    const body = (await res.json()) as ExtractResponse
    const block = body.document.terms[0].blocks[0]
    expect(body.document.terms[0].contentStandard).toBeNull()
    expect(block.contentStandard).toEqual(['Block-level CS'])
    expect(block.skillsFocus?.sourceLabel).toBe('Values to be Developed')
    expect(block.skillsFocus?.items[0].gloss).not.toBeNull()
  })

  it('captures two labeled strands in one block plus documentNotes (MAPEH fixture)', async () => {
    mockDoc({
      learningArea: 'MAPEH',
      documentNotes: '2 hours per week total',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [
                { strandLabel: 'Music and Arts', topicLabel: null, competenciesRaw: '- sing' },
                { strandLabel: 'PE and Health', topicLabel: null, competenciesRaw: '- run' },
              ],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'bow-mapeh.pdf')
    const body = (await res.json()) as ExtractResponse
    expect(body.document.documentNotes).toBe('2 hours per week total')
    expect(body.document.terms[0].blocks[0].strands.map((s) => s.strandLabel)).toEqual([
      'Music and Arts',
      'PE and Health',
    ])
  })

  it('keeps range week with durationDays and two strands (Mathematics fixture)', async () => {
    mockDoc({
      learningArea: 'General Mathematics',
      gradeLevel: 'Grade 11',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1 to 2 (10 days)',
              durationDays: 10,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [
                { strandLabel: 'Geometry', topicLabel: null, competenciesRaw: '- circles' },
                { strandLabel: 'Algebra', topicLabel: null, competenciesRaw: '- equations' },
              ],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'bow-mathematics.pdf')
    const body = (await res.json()) as ExtractResponse
    const block = body.document.terms[0].blocks[0]
    expect(block.weekLabel).toBe('1 to 2 (10 days)')
    expect(block.durationDays).toBe(10)
    expect(block.strands.map((s) => s.strandLabel)).toEqual(['Geometry', 'Algebra'])
    expect(body.document.learningArea).toBe('General Mathematics')
  })

  it('captures multi-entry standards and term-level activity lists (Science fixture)', async () => {
    mockDoc({
      learningArea: 'Science',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: ['Standard A', 'Standard B'],
          performanceStandard: ['Performance A', 'Performance B'],
          skillsFocus: null,
          suggestedActivities: ['Activity 1', 'Activity 2'],
          suggestedPerformanceTasks: ['Task 1'],
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'bow-science.pdf')
    const body = (await res.json()) as ExtractResponse
    const term = body.document.terms[0]
    expect(term.contentStandard).toEqual(['Standard A', 'Standard B'])
    expect(term.suggestedActivities).toEqual(['Activity 1', 'Activity 2'])
    expect(term.suggestedPerformanceTasks).toEqual(['Task 1'])
  })

  it('preserves deep nesting and plain-list skillsFocus (Life and Career Skills fixture)', async () => {
    const deeplyNested = [
      '- Level 1',
      '  - Level 2',
      '    - Level 3',
      '      - Level 4',
      '        - Level 5',
    ].join('\n')
    mockDoc({
      learningArea: 'Life and Career Skills',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: {
            sourceLabel: 'Essential Life Skills',
            items: [{ text: 'Critical thinking', gloss: null }, { text: 'Collaboration', gloss: null }],
          },
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: deeplyNested }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'bow-life-career-skills.pdf')
    const body = (await res.json()) as ExtractResponse
    const term = body.document.terms[0]
    const raw = term.blocks[0].strands[0].competenciesRaw
    expect(raw).toContain('Level 5')
    expect((raw.match(/^  /gm) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(term.skillsFocus?.items).toHaveLength(2)
    expect(term.skillsFocus?.items.every((i) => i.gloss === null)).toBe(true)
  })

  it('maps Filipino labels and preserves them verbatim (Araling Panlipunan fixture)', async () => {
    mockDoc({
      learningArea: 'Araling Panlipunan',
      gradeLevel: 'Baitang 8',
      terms: [
        {
          termLabel: 'Unang Termino',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: 'Linggo 1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- Kasanayan' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'bow-araling-panlipunan.pdf')
    const body = (await res.json()) as ExtractResponse
    expect(body.document.terms[0].termLabel).toBe('Unang Termino')
    expect(body.document.terms[0].blocks[0].weekLabel).toBe('Linggo 1')

    const systemMsg = (
      mockedNimChatDetailed.mock.calls[0][0] as Array<{ role: string; content: string }>
    ).find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('Kasanayang Pampagkatuto')
    expect(systemMsg?.content).toContain('Unang/Ikalawang/Ikatlong Termino')
  })

  it('real unpdf extraction runs end-to-end on the Values Education fixture', async () => {
    mockDoc({
      learningArea: 'Values Education',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    })
    const res = await postFixture(app, 'BOW-[G10]-Values Education-Three-Term.pdf')
    expect(res.status).toBe(200)
    const call = mockedNimChatDetailed.mock.calls[0][0] as Array<{ role: string; content: string }>
    const userMsg = call.find((m) => m.role === 'user')
    expect(userMsg?.content.length).toBeGreaterThan(100)
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter=@eduksource/studio test src/routes/extract.patterns.test.ts`
Expected: PASS (9 structural tests).

- [ ] **Step 4: Run `pnpm fix` and check types**

Run: `pnpm --filter=@eduksource/studio fix` then `pnpm --filter=@eduksource/studio check-types`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/routes/extract.patterns.test.ts apps/studio/tests/fixtures/
git commit -m "test(studio): add structural pattern tests across subject BOW fixtures"
```

---

### Task 6: Full verification and final commit

**Files:** none new.

- [ ] **Step 1: Run the full studio test suite**

Run: `pnpm --filter=@eduksource/studio test`
Expected: ALL PASS (schemas, cache, nim, pdf, route control-flow, route patterns).

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter=@eduksource/studio check-types` then `pnpm --filter=@eduksource/studio lint` then `pnpm --filter=@eduksource/studio fix`
Expected: no errors; working tree has only formatting fixes if any.

- [ ] **Step 3: Manual smoke test (optional, needs real NIM key)**

Run: `pnpm dev` in the worktree, then POST the English fixture:

```bash
curl -s -F "file=@apps/studio/tests/fixtures/BOW-[G7]-English.pdf" http://localhost:3000/api/extract
```

Expected: 200 with `document.learningArea` populated; structured log line shows `learningArea` and `termCount`.

- [ ] **Step 4: Commit any residual formatting**

```bash
git add -A
git commit -m "chore(studio): format after v3 extraction revision"
```

Run only if `git status` is non-empty.

## Spec Coverage Checklist

| Spec requirement | Task |
| --- | --- |
| v3 `BowDocument`/`BowTerm`/`BowBlock`/`BowStrand`/`SkillsFocus` shapes | Task 1 |
| `extractResponse { text, pages, document, warnings, notes }` | Tasks 1, 4 |
| `documentNotes` / `learningArea` / `gradeLevel` from header | Tasks 4, 5 |
| Filipino field-label mapping in prompt; labels preserved verbatim | Tasks 4, 5 |
| Multi-strand blocks; strand labels not inferred | Tasks 4, 5 |
| Per-block vs per-term content/performance standards | Tasks 4, 5 |
| `skillsFocus` with gloss and plain list | Tasks 1, 5 |
| Nested competencies preserved as markdown | Tasks 1, 5 |
| Week `"*"` and range-with-days preserved | Tasks 1, 5 |
| Run-together artifact → `extractionNotes` + `notes` aggregation | Tasks 1, 4 |
| Vision fallback renders PDF pages as images | Tasks 2, 3, 4 |
| `unpdf` throws → vision fallback; both fail → 500 | Task 4 |
| 50-page / 10 MB limits → 413 | Task 4 |
| Empty PDF → graceful 200 empty document | Task 4 |
| Token budget split incl. Filipino terms | Task 4 |
| JSON parse retry once; retry fail → 500 with raw | Task 4 |
| Block-level 8/10-style validation + warning | Task 4 |
| SHA-256 cache hit skips NIM, logs `cacheHit` | Task 4 |
| Real token usage from response metadata | Tasks 2, 4 |
| Structured log `{ fileHash, pages, textLength, tokensUsed, latencyMs, cacheHit, path, learningArea, termCount }` | Task 4 |
| Structural pattern tests (7 subjects, 2 languages) | Task 5 |

## Self-Review notes

- **Vision fallback `pages` handling:** when `unpdf` throws, `pages` is 0 and the page limit is enforced inside `pdfPagesToPngs` via `TooManyPagesError` → 413, so the 51-page rule holds on both paths.
- **Type consistency:** `NimUsage` and `nimChatDetailed`/`nimVisionChat` signatures defined in Task 2 are consumed exactly in Task 4; `pdfPagesToPngs`/`TooManyPagesError` defined in Task 3 used in Task 4; schemas from Task 1 used throughout.
- **`extract.test.ts` mock parity:** Task 4's test file mocks `nimChatDetailed` (not `nimChat`) and adds `pdfPagesToPngs`/`TooManyPagesError` to the `../lib/pdf.js` mock — required because the route now imports those names.
- **`index.ts`:** untouched — `app.route('/api', createExtractRoutes())` already mounts the route.
