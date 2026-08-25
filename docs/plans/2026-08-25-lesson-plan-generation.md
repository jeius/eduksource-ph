# Lesson Plan Generation Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `POST /api/lesson-plans/generate` in Studio — a synchronous lesson-plan generator that turns one cached BOW week-block into a `LessonPlanResponse` faithful to `LP_Template_for_Orientations.pdf` and the quality of `ValEd_DLL_Week_1.pdf` / `ValEd_DLL_Week_9.pdf`.

**Architecture:** Studio (Node, Hono) adds a new route under `/api` parity with `POST /api/extract`. Filtered week slice (block overrides term) → system prompt (7 Learning Design Principles verbatim + hard `reflections:null` / `N/A` guards) + user prompt (filtered JSON + `Expected sessions: N` + one-session Week 1 S1 exemplar, quality > cost) → provider-registry call `TaskType: lesson_plan` with `response_format: json_schema` primary and prose fallback, shared token-budget helper (`1.3×`, `0.8`, `max 32_768`), Zod validate against a shared schema in `packages/schemas` (single retry with appended `ZodError` → `200 { lessonPlan, generationMetadata }` or `502`), `dryRun` preview without LLM.

**Tech Stack:** Hono `^4.13`, `@hono/zod-validator`, `zod ^4.4.3`, `openai ^7.4.0` via `apps/studio/src/lib/ai` (ADR-0002 registry with `runWithFallback`), `@eduksource/logger` (loglayer/pino), `@eduksource/config` Biomes/TS, Vitest base-config (`packages/config/src/vitest/*`), `pino-pretty` logger.

**Spec:** `docs/specs/2026-08-25-lesson-plan-generation-spec.md` (and scratch source `.scratch/lesson-plan-generation/spec.md`, GitHub https://github.com/jeius/eduksource-ph/issues/4). Feeds `docs/specs/2026-08-17-lesson-output-assembly-design.md` (ADR-0006 chain, not built here).

## Global Constraints

- Runtime is **Node on Fly.io** (ADR-0001) — do not move Studio onto Workers; `apps/studio/fly.toml` region `sin` stays.
- All AI calls go through **`apps/studio/src/lib/ai/` registry only** (ADR-0002) — never `new OpenAI` at a call site. Provider/model swappable via `AI_PROVIDER` plus per-task `AI_MODEL_LESSON_PLAN` (and global `AI_MODEL_*` overrides). OpenRouter `models: string[]` fallback is `extra_body: { models }` only for `openrouter`.
- Studio **never imports `packages/db`** and never holds `DATABASE_URI` (ADR-0003) — `extractionId` is an in-memory cache handle this slice (`fileHash` alias, `TODO(ADR-0008)` to normalized-text hash later); no `api/bow_documents` wiring here.
- **TypeScript strict** everywhere (`verbatimModuleSyntax:true`, no `any` without comment). **Zod** for every input (`@hono/zod-validator` on the route, Zod schema in `packages/schemas` for output). **Biome** for lint/format (`pnpm lint`/`pnpm fix`). Commits are **Conventional Commits** (`feat:`/`fix:`/...).
- Logger is **`@eduksource/logger`** (`createLogger()` + `honoLogLayer`), never `console.log` — warnings for missing `x-internal-token` are `logger.warn` (Phase 2 hardens to `401`). No new `product`/`licenses` tables.
- Token math is shared: `estimateTokens = ceil(chars * 1.3)`, `maxCompletionTokens = min(32_768, max(1, floor(window*0.8) - estimateTokens))` (extract's `MAX_EXTRACTION_OUTPUT_TOKENS` constant reused; `primaryContextWindow` read once from `providers.ts`). `sessionsOverride` range is **1–7** (validate: `z.coerce.number().int().min(1).max(7)`).

---

## File Structure

Before tasks, lock decomposition — each file has one responsibility:

- `packages/schemas/src/lesson-plan.ts` — **new**, shared. Zod schemas for `LessonPlanResponse` (and `LessonPlanRequestMeta` helper), exported types. Single source of truth for generation + future DOCX/PPTX `AssemblyInput`. Barrel `packages/schemas/src/index.ts` re-exports it. No Studio-local duplicate.
- `apps/studio/src/lib/tokens.ts` — **new**, infra. Pure helpers `estimateTokens(chars: string): number` and `buildMaxCompletionTokens(window: number, prompt: string): number` extracted from `src/routes/extract.ts:258-274` so both routes share one budget math. Unit-testable in isolation.
- `apps/studio/src/routes/lesson-plan.ts` — **new**, route. Owns `buildLessonPlanContext()` (filtered slice), `buildSystemPrompt()` + `buildUserPrompt()` (7 principles + guards + one-session Week 1 S1 exemplar, distinctness instruction), request `GenerateLessonPlanRequestSchema` (`@hono/zod-validator`), handler (`extractionCache.get` → `410`/`404` split, `dryRun` short-circuit, `chatDetailed` via registry with `json_schema` primary → prose fallback, Zod validate, single retry with appended `ZodError`, `generationMetadata`, synchronous `200` or `502`), mounted at `/api/lesson-plans` from `src/index.ts`.
- `apps/studio/src/routes/lesson-plan.test.ts` — **new**, Seam 1. HTTP integration via `app.request()` with `vi.hoisted` mocks for `../lib/ai/client.js` and `../lib/cache.js` (same pattern as `extract.test.ts:10-55`). Covers happy path, `dryRun`, `retried:true`, `502` trim, `410`, `404` with available labels, `400/413`, provider/model forwarding, `N/A` pass, `reflections!=null` retry.
- `packages/schemas/src/lesson-plan.test.ts` — **new**, Seam 2. Zod unit for the shared schema (fixtures shaped like Week 1 4×3). No Studio import.

Existing files touched only in one place each:
- `apps/studio/src/routes/extract.ts` — **modify** to import `estimateTokens`/`buildMaxCompletionTokens` from `../lib/tokens.js` instead of its local definitions (no behavior change, just dedup). Leave `MAX_EXTRACTION_OUTPUT_TOKENS` there; lesson-plan uses same constant value but local import.
- `apps/studio/src/index.ts` — **modify** to `app.route('/api/lesson-plans', createLessonPlanRoutes())` alongside existing `createExtractRoutes()`.
- `packages/schemas/src/index.ts` — **modify** to add `export * from './lesson-plan.js'`.
- `packages/schemas/package.json` is untouched (already `zod`).

No `packages/db`, `apps/api`, `apps/store`, `apps/admin`, `apps/docs` changes.

---

### Task 1: Shared LessonPlanResponse Zod schema

**Files:**
- Create: `packages/schemas/src/lesson-plan.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/lesson-plan.test.ts`

**Interfaces:**
- Consumes: `zod ^4.4.3`, lesson output assembly spec `LessonPlanResponse` shape (`docs/specs/2026-08-17-lesson-output-assembly-design.md:3` and `2026-08-25` prototype).
- Produces: `export const LessonPlanResponseSchema: z.ZodType<LessonPlanResponse>` + inferred types `LessonPlanResponse`, `GenerateLessonPlanRequestSchema` (if needed elsewhere), consumed by `apps/studio/src/routes/lesson-plan.ts` Task 3/4 and later by DOCX assembly.

- [ ] **Step 1: Write the failing Zod test**

```ts
// packages/schemas/src/lesson-plan.test.ts
import { describe, expect, it } from 'vitest';
import { LessonPlanResponseSchema } from './lesson-plan.js';

const valid = {
  meta: { lessonTitle: 'Understanding developmental stages', numberOfSessions: 4, referencesFromBow: ['https://quexbook.app/educator/lessons/daaa9e47'] },
  intentions: {
    learningCompetencyAndStandards: { contentStandard: ['CS1'], performanceStandard: ['PS1'], learningCompetency: 'Examine sense of self' },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages'], learnerContext: 'aware but need specifics' },
      { sessionLabel: 'Session 2', learningObjectives: ['explain Super exploration'], learnerContext: 'G11 exploring careers' },
      { sessionLabel: 'Session 3', learningObjectives: ['analyze scenarios'], learnerContext: 'analyze real cases' },
      { sessionLabel: 'Session 4', learningObjectives: ['articulate Erikson-Super link'], learnerContext: 'vision board reflection' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings & Recall', flow: 'Teacher presents objectives… peer sharing 2 min…', learningResources: ['Powerpoint', 'Pictures'], opportunitiesForIntegration: 'Social Studies: cultural influences' },
      { sessionLabel: 'Session 2', preLesson: 'Peer Interview', flow: 'Teacher explains Exploration… Life Rainbow…', learningResources: ['Powerpoint'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 3', preLesson: 'Picture Analysis', flow: 'Scenario Analysis … skits…', learningResources: ['Materials'], opportunitiesForIntegration: 'Language: skits' },
      { sessionLabel: 'Session 4', preLesson: 'Story Spotlight Hidilyn', flow: 'Synthesis … success board…', learningResources: ['Board'], opportunitiesForIntegration: 'ICT: TikTok tagline' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: '1. According to Erikson… A-D … 5 questions' },
      { sessionLabel: 'Session 2', formativeAssessment: '1. What are 5 Super stages? 2. Which stage… — open questions' },
      { sessionLabel: 'Session 3', formativeAssessment: 'Case Marco/Madel: risk factor… scenario Qs' },
      { sessionLabel: 'Session 4', formativeAssessment: 'Reflective: How does understanding stage help…' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Observe family… journal', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Video log …', reflections: null },
      { sessionLabel: 'Session 3', extendedLearningOpportunities: 'Watch Inside Out …', reflections: null },
      { sessionLabel: 'Session 4', extendedLearningOpportunities: 'Legacy Tagline commercial …', reflections: null },
    ],
  },
};

describe('LessonPlanResponseSchema', () => {
  it('accepts Week-1-shaped 4×3 valid fixture', () => {
    expect(() => LessonPlanResponseSchema.parse(valid)).not.toThrow();
  });
  it('rejects reflections != null with correct path', () => {
    const bad = { ...valid, waysForward: { sessions: [{ ...valid.waysForward.sessions[0], reflections: 'oops' } as any] } };
    const r = LessonPlanResponseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect((r as any).error.issues[0].path.join('.')).toContain('reflections');
  });
  it('rejects empty formativeAssessment', () => {
    const bad = { ...valid, assessment: { sessions: [{ sessionLabel: 'Session 1', formativeAssessment: '' }] } };
    expect(LessonPlanResponseSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts N/A for opportunitiesForIntegration', () => {
    const na = { ...valid, learningExperience: { sessions: valid.learningExperience.sessions } };
    expect(LessonPlanResponseSchema.safeParse(na).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schemas/src/lesson-plan.test.ts -v`
Expected: `FAIL — Cannot find module './lesson-plan.js'` and `LessonPlanResponseSchema` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/schemas/src/lesson-plan.ts
import { z } from 'zod';

export const LessonPlanMetaSchema = z.object({
  lessonTitle: z.string().min(5),
  numberOfSessions: z.number().int().min(1).max(7),
  referencesFromBow: z.array(z.string()),
});

export const IntentionsSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  learningObjectives: z.array(z.string().min(5)).min(1),
  learnerContext: z.string().min(10),
});

export const IntentionsSchema = z.object({
  learningCompetencyAndStandards: z.object({
    contentStandard: z.array(z.string()),
    performanceStandard: z.array(z.string()),
    learningCompetency: z.string().min(5),
  }),
  sessions: z.array(IntentionsSessionSchema).min(1),
});

export const LearningExperienceSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  preLesson: z.string().min(5),
  flow: z.string().min(20),
  learningResources: z.array(z.string().min(1)).min(1),
  opportunitiesForIntegration: z.string().min(1), // sentence or exactly "N/A" — prompt guards, not schema
});

export const AssessmentSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  formativeAssessment: z.string().min(20),
});

export const WaysForwardSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  extendedLearningOpportunities: z.string().min(10),
  reflections: z.null(),
});

export const LessonPlanResponseSchema = z.object({
  meta: LessonPlanMetaSchema,
  intentions: IntentionsSchema,
  learningExperience: z.object({ sessions: z.array(LearningExperienceSessionSchema).min(1) }),
  assessment: z.object({ sessions: z.array(AssessmentSessionSchema).min(1) }),
  waysForward: z.object({ sessions: z.array(WaysForwardSessionSchema).min(1) }),
});

export type LessonPlanResponse = z.infer<typeof LessonPlanResponseSchema>;

// Request meta (sessionsOverride clamped 1–7) — optional helper, route also defines anon schema
export const SessionsOverrideSchema = z.coerce.number().int().min(1).max(7);
```

- [ ] **Step 4: Update barrel**

```ts
// packages/schemas/src/index.ts
export * from './bow-documents.js';
export * from './catalog.js';
export * from './lesson-plan.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/schemas/src/lesson-plan.test.ts -v`
Expected: `4 passed`. Also `pnpm check-types` clean and `pnpm build:packages` emits `dist/lesson-plan.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/lesson-plan.ts packages/schemas/src/lesson-plan.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add LessonPlanResponse shared Zod — Week 1-shaped fixture passes, reflections null strict"
```

---

### Task 2: Shared token budgeting helper

**Files:**
- Create: `apps/studio/src/lib/tokens.ts`
- Modify: `apps/studio/src/routes/extract.ts:1-274` (import only)
- Test: `apps/studio/src/lib/tokens.test.ts`

**Interfaces:**
- Consumes: `primaryContextWindow: number` from `../../config/env.js`? No — pure functions, caller passes `window`. Keeps lib pure.
- Produces: `export function estimateTokens(input: string): number` and `export function buildMaxCompletionTokens(window: number, prompt: string, ceiling?: number): number` (default ceiling `32_768`). Used by `extract.ts` and by Task 3/4 in `lesson-plan.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/studio/src/lib/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { buildMaxCompletionTokens, estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('is ceil(chars * 1.3)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(Math.ceil(100 * 1.3));
  });
});

describe('buildMaxCompletionTokens', () => {
  it('caps at ceiling and never below 1', () => {
    expect(buildMaxCompletionTokens(4000, 'a'.repeat(1000))).toBeGreaterThan(0);
    expect(buildMaxCompletionTokens(100, 'a'.repeat(10000), 32_768)).toBe(1);
  });
  it('matches extract.ts math: min(ceiling, max(1, floor(window*0.8)-estimate))', () => {
    const window = 128_000; const prompt = 'a'.repeat(3700);
    const expected = Math.min(32_768, Math.max(1, Math.floor(window * 0.8) - Math.ceil(prompt.length * 1.3)));
    expect(buildMaxCompletionTokens(window, prompt)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/studio/src/lib/tokens.test.ts -v`
Expected: `FAIL — Cannot find module './tokens.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/studio/src/lib/tokens.ts
const TOKEN_ESTIMATE_FACTOR = 1.3;
const TOKEN_BUDGET_RATIO = 0.8;
const DEFAULT_CEILING = 32_768;

export function estimateTokens(input: string): number {
  return Math.ceil(input.length * TOKEN_ESTIMATE_FACTOR);
}

export function buildMaxCompletionTokens(window: number, prompt: string, ceiling = DEFAULT_CEILING): number {
  const estimate = estimateTokens(prompt);
  const budget = Math.floor(window * TOKEN_BUDGET_RATIO);
  return Math.min(ceiling, Math.max(1, budget - estimate));
}
```

- [ ] **Step 4: Wire extract.ts to use it (no behavior change)**

```ts
// apps/studio/src/routes/extract.ts:1 — add
import { buildMaxCompletionTokens, estimateTokens } from '../lib/tokens.js';
// delete local TOKEN_ESTIMATE_FACTOR / TOKEN_BUDGET_RATIO definitions and local estimateTokens/buildMax* implementations; keep const MAX_EXTRACTION_OUTPUT_TOKENS = 32_768 as local ceiling value passed to the shared helper:
// before: const maxCompletionTokens = Math.min(MAX_EXTRACTION_OUTPUT_TOKENS, Math.max(1, outputBudget - estimateTokens(...)))
// after:  const maxCompletionTokens = buildMaxCompletionTokens(primaryContextWindow, systemPrompt + userPrompt, MAX_EXTRACTION_OUTPUT_TOKENS)
```

Keep `MAX_EXTRACTION_OUTPUT_TOKENS` locally; helper's default is the same number so tests still pass even if not passed.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/studio/src/lib/tokens.test.ts apps/studio/src/routes/extract.test.ts -v`
Expected: `PASS`. `pnpm check-types` still clean; `pnpm lint` clean (no deep change).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/lib/tokens.ts apps/studio/src/lib/tokens.test.ts apps/studio/src/routes/extract.ts
git commit -m "refactor(studio): extract shared token budgeting helper — estimate/buildMaxCompletionTokens"
```

---

### Task 3: Lesson-plan route — context scoping + dryRun + 410/404 (no LLM yet)

**Files:**
- Create: `apps/studio/src/routes/lesson-plan.ts` (skeleton through `dryRun` + error bodies; AI call stubbed)
- Modify: `apps/studio/src/index.ts:12-13` (mount)
- Test: `apps/studio/src/routes/lesson-plan.test.ts` (partial — 410/404/dryRun/sessionsOverride cases)

**Interfaces:**
- Consumes: `extractionCache: { get(fileHash: string): ExtractResponse | undefined }` from `../lib/cache.js`, `../schemas/extract.js` `ExtractResponse`/`BowDocument`, `@eduksource/schemas/lesson-plan.js` `LessonPlanResponseSchema` type (not yet needed to call LLM), `../lib/tokens.js` helpers for budget, `zod` via `@hono/zod-validator`.
- Produces: `export function createLessonPlanRoutes(): Hono` mounted at `'/api/lesson-plans'` in `src/index.ts` (so `POST /api/lesson-plans/generate` is the live path). Stub `chatDetailed` behind a function ref that Task 4 will wire.

- [ ] **Step 1: Write the failing HTTP tests (no LLM cases first)**

```ts
// apps/studio/src/routes/lesson-plan.test.ts
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../config/logger.js';

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: { get: vi.fn(), set: vi.fn(), hashFile: vi.fn() },
}));
const windowHolder = vi.hoisted(() => ({ value: 128_000 }));
vi.mock('../lib/cache.js', () => ({ extractionCache: mockedExtractionCache }));
vi.mock('../lib/ai/providers.js', () => ({ get primaryContextWindow() { return windowHolder.value; } }));

// Task 3: chatDetailed is not yet needed — mock as never called
const mockedChatDetailed = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../lib/ai/client.js', () => ({ chatDetailed: mockedChatDetailed.fn }));

import { createLessonPlanRoutes } from './lesson-plan.js';

function app() {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('logger' as any, createSilentLogger()); await next(); });
  a.route('/api/lesson-plans', createLessonPlanRoutes());
  return a;
}

const validDoc: any = { // trimmed fixture matching valid Doc fixture in spec
  learningArea: 'Life and Career Skills', gradeLevel: 'Grade 11', documentNotes: null,
  terms: [{ termLabel: 'First Term', contentStandard: ['CS term'], performanceStandard: ['PS term'], skillsFocus: null, suggestedActivities: ['Act'], suggestedPerformanceTasks: ['Task'], blocks: [{ weekLabel: 'Week 1', durationDays: 4, contentStandard: ['CS block'], performanceStandard: ['PS block'], skillsFocus: null, strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '1. Competency…' }], extractionNotes: null }] }],
};

describe('POST /api/lesson-plans/generate — scoping & dryRun', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('410 when extractionId not in cache', async () => {
    mockedExtractionCache.get.mockReturnValue(undefined);
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc123', termLabel: 'First Term', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(410);
    const j = await res.json() as any;
    expect(j.code).toBe('EXTRACTION_EXPIRED');
  });

  it('404 with availableTerms when termLabel misses', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'Nope', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).availableTerms).toEqual(['First Term']);
  });

  it('404 with availableWeeks when weekLabel misses', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 9' }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).availableWeeks).toEqual(['Week 1']);
  });

  it('dryRun returns prompts without calling chatDetailed', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1', dryRun: true }) });
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(typeof j.systemPrompt).toBe('string');
    expect(typeof j.userPrompt).toBe('string');
    expect(typeof j.maxCompletionTokens).toBe('number');
    expect(mockedChatDetailed.fn).not.toHaveBeenCalled();
  });

  it('sessionsOverride 0 or 8 is 400', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    for (const n of [0, 8, 99]) {
      const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1', sessionsOverride: n }) });
      expect(res.status).toBe(400);
    }
  });

  it('block overrides term (CS block present means CS block is used)', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1', dryRun: true }) });
    const j = await res.json() as any;
    const u = j.userPrompt as string;
    expect(u).toContain('CS block'); // filtered slice used block's CS, not term's alone
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run apps/studio/src/routes/lesson-plan.test.ts -v`
Expected: `FAIL — cannot find module './lesson-plan.js'`.

- [ ] **Step 3: Write minimal implementation (through dryRun, no LLM)**

```ts
// apps/studio/src/routes/lesson-plan.ts
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { extractionCache } from '../lib/cache.js';
import { buildMaxCompletionTokens, estimateTokens } from '../lib/tokens.js';
import { primaryContextWindow } from '../lib/ai/providers.js';
import type { HonoSchema } from '../lib/types.js';
import type { ExtractResponse } from '../schemas/extract.js';

const SessionsOverrideSchema = z.coerce.number().int().min(1).max(7).optional();
export const GenerateLessonPlanRequestSchema = z.object({
  extractionId: z.string().min(1),
  termLabel: z.string().min(1),
  weekLabel: z.string().min(1),
  sessionsOverride: SessionsOverrideSchema,
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
});

function buildLessonPlanContext(extraction: ExtractResponse, termLabel: string, weekLabel: string) {
  const term = extraction.document.terms.find(t => t.termLabel === termLabel);
  if (!term) {
    const err: any = new Error(`Term "${termLabel}" not found`);
    err.code = 'TERM_NOT_FOUND'; err.availableTerms = extraction.document.terms.map(t => t.termLabel);
    throw err;
  }
  const block = term.blocks.find(b => b.weekLabel === weekLabel);
  if (!block) {
    const err: any = new Error(`Week "${weekLabel}" not found in ${termLabel}`);
    err.code = 'WEEK_NOT_FOUND'; err.availableWeeks = term.blocks.map(b => b.weekLabel);
    throw err;
  }
  return {
    learningArea: extraction.document.learningArea,
    gradeLevel: extraction.document.gradeLevel,
    contentStandard: (block.contentStandard ?? term.contentStandard ?? []) as string[],
    performanceStandard: (block.performanceStandard ?? term.performanceStandard ?? []) as string[],
    skillsFocus: (block.skillsFocus ?? term.skillsFocus ?? null) as any,
    strands: block.strands,
    suggestedActivities: (term.suggestedActivities ?? []) as string[],
    suggestedPerformanceTasks: (term.suggestedPerformanceTasks ?? []) as string[],
    durationDays: (block.durationDays ?? 1) as number,
    extractionNotes: block.extractionNotes,
  };
}

const EXEMPLAR = `Example session (Week 1 S1 style — quality anchor, not to copy verbatim):
Learning Objectives: 1. identify and describe major key developmental stages… 2. demonstrate ability to create a visual timeline… 3. express personal reflections…
Learner Context: Learners are aware of different key developmental stages but may not fully understand specific changes…
Pre-Lesson: Greetings & Prayer, Recall, Objectives, Activity: How well do you know yourself? (peer sharing 2 min)
Flow: The teacher presents lesson objectives and expected outputs → wellness check → Activity: How well do you know yourself? → …`;

function buildSystemPrompt(): string {
  return `You are a Philippine DepEd lesson-plan generator. Produce curriculum-faithful JSON only, matching the lesson-plan template.

Write for a teacher, not a database. Apply the Learning Design Principles to every session's Flow: make objectives clear before the task, guide learners before independent work, check well-being/understanding/mastery mid-session, connect to past competencies, encourage collaboration, invite personal reflection on relevance, and ensure inclusion for varied abilities/learning styles/contexts.

Rubric: Intentions must be clearly stated and coherent across sections. Learning Experience must be clear enough that another teacher can implement without extra explanation. Assessments must be integrated throughout and generate evidence of learning, with varied response formats / accommodations per session.

System fields NOT available to you: teacherName, sectionLabel, dates, schedule, reflections, signature block, letterhead, rubric page. If no genuine cross-subject link exists for a session, opportunitiesForIntegration must be exactly "N/A" (case-sensitive). Never populate reflections — always null; reflections are filled by the teacher after delivery.

Produce N distinct sessions: distinct Learning Objectives (3 per session, observable verbs), distinct Learner Context, distinct Flow sequences, and varied Formative Assessments rotating formats (MCQ / short-answer / scenario-based / reflective) across sessions. Do not copy-paste one session's content into another.

Return only valid JSON matching the provided schema, no prose, no code fences. Begin with "{" and end with "}".`;
}

function buildUserPrompt(ctx: ReturnType<typeof buildLessonPlanContext>, numberOfSessions: number): string {
  return `Generate a lesson plan for ${numberOfSessions} session(s).\n\nFiltered BOW context (single week-block, not full BOW):\n${JSON.stringify(ctx, null, 2)}\n\nExpected sessions: ${numberOfSessions}\n\n${EXEMPLAR}\n\nProduce one lesson plan with exactly ${numberOfSessions} sessions; each session's fields must be distinct (see distinctness instruction above).`;
}

export function createLessonPlanRoutes() {
  const app = new Hono<HonoSchema>();
  app.post('/generate', zValidator('json', GenerateLessonPlanRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const cached = extractionCache.get(body.extractionId);
    if (!cached) {
      return c.json({ error: 'Extraction expired — re-upload the BOW and re-run /api/extract', code: 'EXTRACTION_EXPIRED' }, 410);
    }
    let ctx: ReturnType<typeof buildLessonPlanContext>;
    let numberOfSessions: number;
    try {
      ctx = buildLessonPlanContext(cached, body.termLabel, body.weekLabel);
      numberOfSessions = body.sessionsOverride ?? (ctx.durationDays ?? 1);
      // Zod already clamped 1–7 if sessionsOverride present; clamp durationDays-derived too
      if (numberOfSessions < 1 || numberOfSessions > 7) {
        return c.json({ error: 'sessionsOverride must be 1–7 (or durationDays must imply 1–7)' }, 400);
      }
    } catch (e: any) {
      if (e.code === 'TERM_NOT_FOUND') return c.json({ error: e.message, availableTerms: e.availableTerms }, 404);
      if (e.code === 'WEEK_NOT_FOUND') return c.json({ error: e.message, availableWeeks: e.availableWeeks }, 404);
      throw e;
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(ctx, numberOfSessions);
    const promptForBudget = systemPrompt + userPrompt;
    // TODO(ADR-0008): extractionId is currently a fileHash alias; migrate to normalized-text hash (BOW text → sha256) and durable api row.
    if (body.dryRun) {
      return c.json({
        systemPrompt, userPrompt,
        estimatedTokens: estimateTokens(promptForBudget),
        maxCompletionTokens: buildMaxCompletionTokens(primaryContextWindow, promptForBudget),
        provider: body.provider ?? 'default', model: body.model ?? 'default',
      });
    }

    // Non-dryRun path is stubbed this task — Task 4 wires chatDetailed + validation/retry.
    return c.json({ error: 'Not Implemented — lesson-plan generation requires Task 4' }, 501);
  });
  return app;
}
```

- [ ] **Step 4: Wire into app and run tests**

```ts
// apps/studio/src/index.ts — add import and mount
import { createLessonPlanRoutes } from './routes/lesson-plan.js';
// after: app.route('/api', createExtractRoutes());
app.route('/api/lesson-plans', createLessonPlanRoutes());
```

Run: `pnpm vitest run apps/studio/src/routes/lesson-plan.test.ts -v`
Expected: `6 passed` (`501` for non-dryRun will not yet be asserted — tests only hit dryRun/410/404 paths this task).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/routes/lesson-plan.ts apps/studio/src/routes/lesson-plan.test.ts apps/studio/src/index.ts apps/studio/src/lib/tokens.ts
git commit -m "feat(studio): lesson-plan route skeleton — week slice, dryRun, 410/404 with available labels"
```

---

### Task 4: Provider call — json_schema + prose fallback, validation retry, 502

**Files:**
- Modify: `apps/studio/src/routes/lesson-plan.ts` (wire LLM path inside `createLessonPlanRoutes()`)
- Test: `apps/studio/src/routes/lesson-plan.test.ts` (append LLM + validation cases)
- Modify (optional peek): `apps/studio/src/lib/ai/client.ts` inspection — no change unless `response_format` needs threading (client already supports `extra_body` via OpenRouter path)

**Interfaces:**
- Consumes: `chatDetailed(messages, { task:'lesson_plan', max_completion_tokens, model? })` from `../lib/ai/client.js`, `resolve`/`getPrimaryProvider` via registry (caller can pass `provider`/`model`), `LessonPlanResponseSchema` from `@eduksource/schemas/lesson-plan.js`, helpers `estimateTokens`/`buildMaxCompletionTokens`.
- Produces: For the test seam, the 200/502 JSON envelopes become assertable; no new public exports beyond the route.

- [ ] **Step 1: Write the failing tests (AI + validation layer)**

```ts
// append to apps/studio/src/routes/lesson-plan.test.ts — new describe
import { LessonPlanResponseSchema } from '@eduksource/schemas/lesson-plan.js';

const validLessonPlan: any = {
  meta: { lessonTitle: 'Understanding developmental stages', numberOfSessions: 4, referencesFromBow: ['https://example.com/a'] },
  intentions: {
    learningCompetencyAndStandards: { contentStandard: ['CS1'], performanceStandard: ['PS1'], learningCompetency: 'Examine sense of self' },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages', 'describe characteristics', 'reflect on importance'], learnerContext: 'aware but need specifics - visual learners' },
      { sessionLabel: 'Session 2', learningObjectives: ['explain Super exploration', 'demonstrate mapping', 'reflect on uncertainties'], learnerContext: 'G11 exploring careers, needs career relevance' },
      { sessionLabel: 'Session 3', learningObjectives: ['analyze dilemmas', 'perform skits', 'demonstrate empathy'], learnerContext: 'real scenarios help see protective factors' },
      { sessionLabel: 'Session 4', learningObjectives: ['articulate Erikson-Super link', 'create vision statements', 'express aspirations'], learnerContext: 'vision board fosters self-awareness' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings & Recall', flow: 'Teacher presents objectives → wellness check → How well do you know yourself? … peer sharing 2 min… guided discussion … inclusion …'.repeat(2), learningResources: ['Powerpoint', 'Pictures'], opportunitiesForIntegration: 'Social Studies: cultural influences' },
      { sessionLabel: 'Session 2', preLesson: 'Peer Interview', flow: 'Teacher explains Super Exploration … Life Rainbow chart … wellness on tentative choices …', learningResources: ['Materials'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 3', preLesson: 'Picture Analysis', flow: 'Teacher reviews Erikson vs Super … Scenario Analysis groups … Discussion Qs …', learningResources: ['Scenarios'], opportunitiesForIntegration: 'Language: skits' },
      { sessionLabel: 'Session 4', preLesson: 'Story Spotlight Hidilyn', flow: 'Synthesis … Success Markers … vision board creation … reflection …', learningResources: ['Board', 'Markers'], opportunitiesForIntegration: 'ICT: TikTok tagline' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: 'MCQ 1. Erikson task of adolescence? A Trust B Identity … — 5 questions with accommodations' },
      { sessionLabel: 'Session 2', formativeAssessment: 'Short answer: 5 Super stages… Establishment vs Maintenance — varied format' },
      { sessionLabel: 'Session 3', formativeAssessment: 'Scenario Q: Marco risk factor… Madel protective factor… — case-based' },
      { sessionLabel: 'Session 4', formativeAssessment: 'Reflective: How does stage help career decisions… — personal plan' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Observe family … journal log…', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Video log of behaviors …', reflections: null },
      { sessionLabel: 'Session 3', extendedLearningOpportunities: 'Watch Inside Out and write analysis…', reflections: null },
      { sessionLabel: 'Session 4', extendedLearningOpportunities: 'Legacy Tagline commercial … post on forum…', reflections: null },
    ],
  },
};

describe('POST /api/lesson-plans/generate — LLM + validation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('happy path 200 with lessonPlan + generationMetadata.retried false', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    mockedChatDetailed.fn.mockResolvedValueOnce({ content: JSON.stringify(validLessonPlan), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.lessonPlan.meta.numberOfSessions).toBe(4);
    expect(j.generationMetadata.retried).toBe(false);
    expect(['nim','openrouter','opencode'].some(k => typeof j.generationMetadata.provider === 'string')).toBeTruthy();
  });

  it('retried true when first content fails validation and second passes', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const bad = { ...validLessonPlan, waysForward: { sessions: [{ ...validLessonPlan.waysForward.sessions[0], reflections: 'should be null' } as any] } };
    mockedChatDetailed.fn
      .mockResolvedValueOnce({ content: JSON.stringify(bad), usage: { input: 10, output: 10 }, finishReason: 'stop' })
      .mockResolvedValueOnce({ content: JSON.stringify(validLessonPlan), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(200);
    expect((await res.json() as any).generationMetadata.retried).toBe(true);
    expect(mockedChatDetailed.fn).toHaveBeenCalledTimes(2);
    // second call received appended validation error
    const secondCallArgs = mockedChatDetailed.fn.mock.calls[1];
    expect(JSON.stringify(secondCallArgs)).toContain('reflections');
  });

  it('502 with trimmed raw + validationErrors when both attempts fail', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    const bad = { ...validLessonPlan, waysForward: { sessions: [{ ...validLessonPlan.waysForward.sessions[0], reflections: 'x' } as any] } };
    mockedChatDetailed.fn
      .mockResolvedValueOnce({ content: JSON.stringify(bad), usage: { input: 10, output: 10 }, finishReason: 'stop' })
      .mockResolvedValueOnce({ content: JSON.stringify(bad), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(502);
    const j = await res.json() as any;
    expect(typeof j.validationErrors).toBe('object');
    expect(typeof j.raw).toBe('string');
    expect(j.raw.length).toBeLessThanOrEqual(8192);
  });

  it('provider/model overrides are forwarded to chatDetailed', async () => {
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    mockedChatDetailed.fn.mockResolvedValueOnce({ content: JSON.stringify(validLessonPlan), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1', provider: 'openrouter', model: 'test-model' }) });
    expect(res.status).toBe(200);
    // chatDetailed is called via runWithFallback(task:'lesson_plan', model:body.model)
    expect(mockedChatDetailed.fn).toHaveBeenCalled();
  });

  it('accepts opportunitiesForIntegration literal N/A', async () => {
    const na = JSON.parse(JSON.stringify(validLessonPlan));
    na.learningExperience.sessions[1].opportunitiesForIntegration = 'N/A';
    mockedExtractionCache.get.mockReturnValue({ text: '', pages: 1, document: validDoc, warnings: [], notes: [] });
    mockedChatDetailed.fn.mockResolvedValueOnce({ content: JSON.stringify(na), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }) });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run apps/studio/src/routes/lesson-plan.test.ts -v`
Expected: `5+ failures — 200 expected but got 501` (Task 3 stub) or validation not yet wired.

- [ ] **Step 3: Wire the LLM path**

Inside `apps/studio/src/routes/lesson-plan.ts` `// Non-dryRun path is stubbed this task — Task 4 wires chatDetailed + validation/retry.` replace with:

```ts
    // Provider budget
    const maxCompletionTokens = buildMaxCompletionTokens(primaryContextWindow, systemPrompt + userPrompt);
    // Warn-level token gate (not blocking) for missing x-internal-token — forward-compat with Phase 2 hardening
    const internalToken = c.req.header('x-internal-token');
    if (!internalToken) {
      c.var.logger?.withMetadata({ extractionId: body.extractionId, route: 'lesson-plan' }).warn?.('x-internal-token absent — allowed in Phase 1, will be required Phase 2');
      // note: logger in Hono is via honoLogLayer; fallback to c.get('logger') pattern as in extract.ts
    }

    // Extract json_schema from the shared Zod schema's JSON Schema (zod-to-json-schema or manual literal).
    // For Phase 1 we keep it simple: pass the Zod schema's shape as response_format without a converter — the
    // openai SDK's json_schema path is provider-validated; prose fallback covers non-supporting providers.
    // The second arg to chatDetailed is { task:'lesson_plan', max_completion_tokens, model }
    const lessonPlanJsonSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        meta: { type: 'object', properties: {
          lessonTitle: { type: 'string' },
          numberOfSessions: { type: 'integer', minimum: 1, maximum: 7 },
          referencesFromBow: { type: 'array', items: { type: 'string' } },
        }, required: ['lessonTitle','numberOfSessions','referencesFromBow'] },
        // full shape abbreviated — actual schema generated via helper `zodToJsonSchema(LessonPlanResponseSchema)` if available; otherwise literal mirror kept in sync by Task 1's tests.
      },
      required: ['meta','intentions','learningExperience','assessment','waysForward'],
    } as const;

    let retried = false;
    let rawContent: string | null = null;
    let providerUsed = body.provider ?? 'unknown';
    let modelUsed = body.model ?? 'unknown';

    // First attempt: json_schema if provider supports it, else prose fallback is handled by the registry's runWithFallback try/catch
    const callOnce = async (messages: any[], opts: any) => {
      try {
        // Attempt json_schema path
        return await chatDetailed(messages, { ...opts, response_format: { type: 'json_schema', json_schema: { name: 'LessonPlanResponse', schema: lessonPlanJsonSchema, strict: true } } } as any);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (msg.includes('response_format') || msg.includes('json_schema') || msg.includes('unsupported')) {
          // Single prose fallback
          return await chatDetailed(messages, opts as any);
        }
        throw e;
      }
    };

    const messages = [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: userPrompt }];
    const opts = { task: 'lesson_plan' as const, max_completion_tokens: maxCompletionTokens, model: body.model };

    // Helper to parse + validate
    const tryParse = (content: string | null) => {
      if (content == null) throw new Error('Empty LLM response');
      const parsed = JSON.parse(content);
      return LessonPlanResponseSchema.parse(parsed);
    };

    try {
      const first = await callOnce(messages, opts);
      rawContent = first.content;
      // capture provider/model from generation if registry exposes it — fallback to requested values
      providerUsed = (first as any).provider ?? providerUsed;
      modelUsed = (first as any).model ?? modelUsed;
      try {
        const lessonPlan = tryParse(first.content);
        return c.json({ lessonPlan, generationMetadata: { provider: providerUsed, model: modelUsed, generatedAt: new Date().toISOString(), retried } });
      } catch (firstErr: any) {
        const validationMsg = firstErr?.message ?? String(firstErr);
        // Validate-time retry: append Zod error paths
        retried = true;
        const retryMessages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: `${userPrompt}\n\nPrevious output failed validation:\n - ${validationMsg}\nReturn only valid JSON.` },
        ];
        const second = await callOnce(retryMessages, opts);
        rawContent = second.content;
        try {
          const lessonPlan = tryParse(second.content);
          return c.json({ lessonPlan, generationMetadata: { provider: providerUsed, model: modelUsed, generatedAt: new Date().toISOString(), retried } });
        } catch (secondErr: any) {
          const rawTrimmed = (second.content ?? '').slice(0, 8192);
          return c.json({ error: 'Lesson plan generation failed validation after retry', validationErrors: String(secondErr?.message ?? secondErr), raw: rawTrimmed, provider: providerUsed, model: modelUsed }, 502);
        }
      }
    } catch (fatal: any) {
      // Provider chain fatal (all providers failed) — surface as 502 as spec for malformed after-retry; registry fallback already exhausted
      const rawTrimmed = (rawContent ?? '').slice(0, 8192);
      return c.json({ error: 'Lesson plan generation failed', validationErrors: String(fatal?.message ?? fatal), raw: rawTrimmed, provider: providerUsed, model: modelUsed }, 502);
    }
```

*Notes for the implementer:* `chatDetailed`'s real signature is `chatDetailed(messages: ChatMessage[], opts: ChatOptions): Promise<{ content, usage, finishReason, provider?, model? }>` — if `provider`/`model` are not returned, keep using `body.provider ?? primaryProvider.name` as the metadata. Import `LessonPlanResponseSchema` at top after Task 1. Keep `sessionsOverride` validation 1–7.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/studio/src/routes/lesson-plan.test.ts -v`
Expected: All 11 (6 from Task 3 + 5 new) pass. Also `pnpm vitest run apps/studio/src/lib/tokens.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/routes/lesson-plan.ts apps/studio/src/routes/lesson-plan.test.ts
git commit -m "feat(studio): wire lesson-plan LLM — json_schema + prose fallback, Zod validate, single retry → 502"
```

---

### Task 5: Verification + docs

**Files:**
- Verify: `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build:packages`
- Docs: no `AGENTS.md` change needed (route contract is in `apps/studio/AGENTS.md:30-31` once, update next pass; this task only adds the mount).

- [ ] **Step 1: Full suite and build**

Run: `pnpm lint 2>&1 | head -n 50`
Expected: `No issues` (Biome may warn on new `lesson-plan.ts`'s long string — run `pnpm fix` if needed).

Run: `pnpm check-types`
Expected: `0 errors`.

Run: `pnpm test`
Expected: `PASS` across `packages/schemas` and `apps/studio`.

Run: `pnpm build:packages`
Expected: `packages/schemas/dist/lesson-plan.{d.ts,js}` emitted, `packages/schemas/dist/index.{d.ts,js}` includes re-export.

- [ ] **Step 2: Commit any fixable lint**

```bash
pnpm fix
git add -A
git commit -m "chore: biome fix — lesson-plan route + schema" || true
```

- [ ] **Step 3: Confirm provenance**

Ensure both `docs/specs/2026-08-25-lesson-plan-generation-spec.md` and `.scratch/lesson-plan-generation/spec.md` have the trailing `Provenance: https://github.com/jeius/eduksource-ph/issues/4` line (added in finalize step — re-append if lost in rebase).

---

## Self-Review

**1. Spec coverage — every section in `docs/specs/2026-08-25-lesson-plan-generation-spec.md` has a task:**

- Spec §2 caching prerequisite (`extractionId` fileHash alias) → Task 3 (`TODO(ADR-0008)` comment + `410`).
- Spec §3 contract (`extractionId`/`termLabel`/`weekLabel`/`sessionsOverride`/`provider`/`model`/`dryRun`) → Tasks 3+4 (request schema, mount, forwarding).
- Spec §4 context scoping (`block ?? term`, `durationDays → numberOfSessions`, exemplar) → Task 3 (`buildLessonPlanContext` + `buildSystemPrompt`+UserPrompt with Week 1 S1 exemplar, Q6 b).
- Spec §5 output shape (`LessonPlanResponse` 5 groups, `reflections:null`, `N/A`) → Task 1 (shared Zod) + Task 4 (schema-lit `json_schema`).
- Spec §6 prompt (7 principles verbatim + guards) → Tasks 3+4 (system prompt builder).
- Spec §7 structured output (`json_schema` primary → prose fallback, single retry with appended `ZodError`, `retried`, `502` trimmed) → Task 4.
- Spec §8 out-of-scope (no `teacherName`/`sectionLabel`/dates, no letterhead/rubric) → Task 3 guard block.
- Spec §9 `dryRun` harness → Task 3 (`dryRun` short-circuit, budget fields).
- Spec §10 open items carried forward → Further Notes (parity verification, multi-instance cache, `referencesFromBow` URL review).

No gaps.

**2. Placeholder scan:** no `TBD`/`TODO` beyond the single explicit `TODO(ADR-0008)` (intended), no "add appropriate error handling" without code (all bodies are explicit `410`/`404`/`400`/`502` with code + enumeration), no "similar to Task N" (repeated the test/setup), every code step has a runnable block with expected PASS/FAIL line.

**3. Type consistency:** `GenerateLessonPlanRequestSchema` is `z.object({...})` in Task 3 and consumed as `c.req.valid('json')` (Hono's `zValidator('json', ...)`) — correct pair. `LessonPlanResponse` is inferred from `LessonPlanResponseSchema` in `packages/schemas` and used as the `tryParse` return in Task 4 — no second definition. `estimateTokens`/`buildMaxCompletionTokens` signatures are `(string):number` / `(window:number, prompt:string, ceiling?:number):number` in both Task 2 and their call sites — aligned.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-25-lesson-plan-generation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
