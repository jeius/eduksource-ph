Status: ready-for-agent

## Problem Statement

Teachers need a slide deck (PPTX) for classroom projection that matches the pedagogical arc of a generated lesson plan. The lesson plan (`LessonPlanResponse`) is already generated and reviewed by an editor — it contains the objectives, flow, assessment, and extended learning opportunities for a specific session. But a lesson plan is a teacher-facing document (stage directions, rubrics, reflections blanks), and teachers also need a student-facing visual aid: a deck of 25-30 slides that follows the DepEd lesson phase structure (title → objectives → motivation → content → activity → check → closing), with each slide keeping text to ~30% of the space and reserving the remaining ~70% for images (Phase 2) or whitespace. Teachers typically reuse one deck across all sessions of a week-block, so the deck should be generated from a single session's content, not all sessions.

The deck must be a downloadable `.pptx` file the editor can open, review, and hand to a teacher — not an intermediate JSON that needs a second request to assemble.

## Solution

A synchronous `POST /api/slides/generate` route in `apps/studio` that accepts a pre-generated `LessonPlanResponse` (validated against the shared Zod schema) plus an `extractionId` for system fields (learning area, grade level), generates a `SlideDeckSpec` via the AI provider registry (`TaskType: 'lesson_plan'` — same model as lesson-plan, since slide generation enriches content for quality rather than just restructuring), validates the output against a shared `SlideDeckSpecSchema`, assembles a PPTX file via `pptxgenjs` in an inline pure function (`assemblePptx`), and returns the binary file with generation metadata in response headers. A `dryRun` mode returns prompts and token budget without calling the LLM.

Slide content is generated **from the `LessonPlanResponse`**, not from the raw BOW — enforcing ADR-0006 structurally (the route literally cannot see the BOW). One session's content (default: session 1, overridable via `sessionLabel`) is extracted and passed to the prompt. The generator adds pedagogical detail and visual descriptions — it doesn't just restructure. Each slide's `speakerNotes` draw from the corresponding `flow` paragraph (teacher guidance while presenting, per assembly spec §5.2). `imagePrompt` is populated on content/activity slides with descriptive visual prompts for Phase 2 image rendering, but the Phase 1 assembler renders whitespace where images would go.

## User Stories

1. As an editor, I want to pass a reviewed `LessonPlanResponse` to a slides route and receive a downloadable PPTX file, so that I don't need a second request to assemble the deck.
2. As an editor, I want to select which session's content goes into the deck (default session 1), so that I can choose the richest session for classroom projection.
3. As an editor, I want the deck to follow the DepEd lesson phase structure (title → objectives → motivation → 3-4 content → activity → check → closing), so that it matches how teachers actually deliver lessons.
4. As an editor, I want each slide to be ~30% text and ~70% visual space, so that students aren't overwhelmed by walls of text on-screen.
5. As an editor, I want the `flow` narrative to appear in speaker notes (not on slide faces), so that teachers get the same pedagogical guidance as the DOCX while presenting, without putting teacher-facing text in front of students.
6. As an editor, I want `imagePrompt` fields populated with visual descriptions on content/activity slides, so that Phase 2 can generate images without re-running the deck generation.
7. As an editor, I want to override `teacherName`, `sectionLabel`, and `bowReference` via the request body, so that the title slide shows real teacher/class info when available.
8. As an editor, I want `teacherName`/`sectionLabel` to default to a fill-in-the-blank placeholder when not provided, so that the teacher can complete them by hand.
9. As an editor, I want a `dryRun` mode that returns the system prompt, user prompt, and token budget without calling the LLM, so that I can A/B test prompts across providers without spending tokens.
10. As an editor, I want per-request `provider`/`model` overrides, so that I can test slide generation quality across NIM/OpenRouter/Opencode Go.
11. As an editor, I want a `410 Gone` response when the `extractionId` has expired from cache, so that I know to re-upload the BOW before generating slides.
12. As an editor, I want a `400 Bad Request` when the `lessonPlan` field fails `LessonPlanResponseSchema` validation, so that I know the input lesson plan is malformed before any LLM call.
13. As an editor, I want the slides route to reject an unknown `sessionLabel` with a `404` listing available sessions, so that I can pick the right one.
14. As an editor, I want the AI to generate 25-30 slides per deck, so that each phase of the lesson has adequate coverage without overflow.
15. As an editor, I want the AI to add a `motivation` slide (hook/engagement activity) between objectives and content, so that the deck follows the DepEd lesson phase structure.
16. As an editor, I want the AI to produce student-facing bullets (not teacher stage directions), so that the slides are appropriate for classroom projection.
17. As an editor, I want the generation to use `json_schema` strict mode as the primary output format, so that the output is structurally valid before validation.
18. As an editor, I want a single retry with appended validation errors when the first output fails Zod validation, so that transient model errors are self-corrected.
19. As an editor, I want a `502` response with trimmed raw output and validation errors when both attempts fail, so that I can debug what went wrong.
20. As an editor, I want the `generationMetadata` (provider, model, generatedAt, retried) in response headers, so that I know which provider/model produced the deck.
21. As an editor, I want the route to warn (not hard-fail) when `x-internal-token` is missing, so that Phase 1 dev isn't blocked by auth hardening.
22. As a teacher, I want a deck I can reuse across all sessions of a week-block, so that I don't need a different deck for each session timeslot.
23. As a teacher, I want the speaker notes to contain the detailed `flow` narrative, so that I have the same guidance as the lesson plan while presenting.
24. As a developer, I want `SlideDeckSpecSchema` in the shared schemas package, so that DOCX assembly and admin preview can consume the same type.
25. As a developer, I want `assemblePptx` to be a pure function separate from the route, so that I can unit-test the pptxgenjs assembly in isolation.
26. As a developer, I want the shared token budgeting helper reused from the lesson-plan route, so that both routes share one budget math.
27. As a developer, I want `studio-constants.ts` (`TEACHER_FILL_BLANK`, `TEACHER_FILL_NOTE`) in the shared schemas package, so that the DOCX generator (next checkbox) can import them without a separate constants file.
28. As a developer, I want the `motivation` layout type in the `SlideDeckSpec` layout union, so that the assembler can render motivation slides with distinct styling.
29. As a developer, I want the route to use `TaskType: 'lesson_plan'` (not a new `'slides'` task type), so that the same model is used for lesson-plan and slide generation since slides enrich content for quality.
30. As a developer, I want no image rendering in Phase 1, so that the `imagePrompt` field is forward-compatible but the assembler doesn't need an image adapter yet.

## Implementation Decisions

### New modules

- **`packages/schemas/src/slide-deck.ts`** — `SlideDeckSpecSchema` Zod schema and inferred `SlideDeckSpec` type. Layout union: `'title' | 'objectives' | 'motivation' | 'content' | 'activity' | 'checkForUnderstanding' | 'closing'` (7 layouts, `motivation` is new per assembly spec §5.1 + grilling Q12). Each slide: `layout`, `heading: string`, `bullets?: string[]`, `speakerNotes?: string`, `imagePrompt?: string | null`. Sessions: `{ sessionLabel: string, slides: Slide[] }`. Top-level: `{ title: string, sessions: Session[] }`. Re-exported from `packages/schemas/src/index.ts` barrel + subpath exports `./slide-deck` and `./slide-deck.js` (same pattern as `./lesson-plan`).

- **`packages/schemas/src/studio-constants.ts`** — `TEACHER_FILL_BLANK` (visual blank line string) and `TEACHER_FILL_NOTE` (fill-in note string) per assembly spec §2. Exported from barrel. PPTX assembler ignores these; DOCX generator (next checkbox) imports them.

- **`apps/studio/src/lib/pptx.ts`** — `assemblePptx(slideDeck: SlideDeckSpec, systemFields: SystemFields): Buffer`. Pure function that creates a `new pptxgen()` instance, sets `LAYOUT_WIDE`, iterates sessions/slides, renders each layout type with pptxgenjs calls (`addText`, `addNotes`), and returns the file as a `Buffer` via `write({ outputType: 'nodebuffer' })`. Title slide includes `lessonTitle` + systemFields (teacherName/sectionLabel → `TEACHER_FILL_BLANK` when null). Content slides set `speakerNotes` from the slide's `speakerNotes` field. `imagePrompt` is ignored (whitespace rendered). Fresh options object per slide (pptxgenjs mutates in place). No `#` in hex colors. `bullet: true` per item, never literal `•`.

- **`apps/studio/src/routes/slides.ts`** — `POST /api/slides/generate` route. Request schema: `{ lessonPlan: unknown, extractionId: string, termLabel: string, weekLabel: string, sessionLabel?: string, systemFields?: { teacherName?: string|null, sectionLabel?: string|null, bowReference?: string }, provider?: string, model?: string, dryRun?: boolean }`. Validates `lessonPlan` against `LessonPlanResponseSchema` (400 on failure). Fetches extraction via `extractionCache.get(extractionId)` (410 on miss). Extracts `gradeLevel` + `learningArea` from extraction. Selects session (default `sessions[0]`, 404 with `availableSessions` on miss). Builds system prompt + user prompt. When `dryRun: true` → JSON `{ systemPrompt, userPrompt, estimatedTokens, maxCompletionTokens, provider, model }`. When `dryRun: false` → calls `chatDetailed` with `response_format: json_schema` (strict) primary → prose fallback on unsupported → `SlideDeckSpecSchema.parse` → single retry with appended ZodError → `assemblePptx` → binary response with headers. Mounted at `app.route('/api/slides', createSlidesRoutes())`.

- **`apps/studio/src/lib/pptx.ts` (test)** — `apps/studio/src/lib/pptx.test.ts` — unit tests for `assemblePptx`.

- **`apps/studio/src/routes/slides.ts` (test)** — `apps/studio/src/routes/slides.test.ts` — integration tests via `app.request()`.

### Modified modules

- **`packages/schemas/src/index.ts`** — add `export * from './slide-deck.js'` and `export * from './studio-constants.js'`.
- **`packages/schemas/package.json`** — add `./slide-deck` and `./slide-deck.js` subpath exports (same pattern as `./lesson-plan`).
- **`apps/studio/src/index.ts`** — mount `app.route('/api/slides', createSlidesRoutes())`.
- **`apps/studio/package.json`** — add `pptxgenjs` dependency.
- **`apps/studio/src/config/env.ts`** — no changes needed (uses existing `AI_MODEL_LESSON_PLAN` override, not a new `AI_MODEL_SLIDES`).

### API contract

```
POST /api/slides/generate
Content-Type: application/json

Request body:
{
  "lessonPlan": { ... },            // LessonPlanResponse — validated against shared Zod
  "extractionId": "abc123",         // file-hash alias (TODO ADR-0008)
  "termLabel": "First Term",
  "weekLabel": "Week 1",
  "sessionLabel": "Session 1",     // optional, default sessions[0]
  "systemFields": {                 // optional
    "teacherName": "Maiza R. Evangelista",  // null → TEACHER_FILL_BLANK
    "sectionLabel": "11-Tesla",             // null → TEACHER_FILL_BLANK
    "bowReference": "DepEd BOW — First Term, Week 1"  // default system-templated
  },
  "provider": "openrouter",        // optional override
  "model": "test-model",           // optional override
  "dryRun": false                   // optional, default false
}

Response (dryRun: true):
200 application/json
{ "systemPrompt": "...", "userPrompt": "...", "estimatedTokens": 1234, "maxCompletionTokens": 31000, "provider": "nim", "model": "..." }

Response (dryRun: false, success):
200 application/vnd.openxmlformats-officedocument.presentationml.presentation
Content-Disposition: attachment; filename="slides.pptx"
X-Provider: nim
X-Model: ...
X-Retried: false
X-Generated-At: 2026-08-25T18:30:00.000Z
<binary PPTX body>

Response (extractionId expired):
410 application/json
{ "code": "EXTRACTION_EXPIRED" }

Response (lessonPlan invalid):
400 application/json
{ "error": "Invalid lesson plan", "validationErrors": "..." }

Response (sessionLabel not found):
404 application/json
{ "error": "Session 'Session 5' not found", "availableSessions": ["Session 1", "Session 2", "Session 3", "Session 4"] }

Response (validation retry exhausted):
502 application/json
{ "error": "Slide deck generation failed validation after retry", "validationErrors": "...", "raw": "...(trimmed to 8192)", "provider": "nim", "model": "..." }
```

### AI provider call (ADR-0002)

- `chatDetailed` via registry with `TaskType: 'lesson_plan'` (same model as lesson-plan generation — grilling Q8: slides enrich content for quality, not just restructure).
- `response_format: { type: 'json_schema', json_schema: { name: 'SlideDeckSpec', schema: slideDeckJsonSchema, strict: true } }` primary → prose fallback on `response_format`/`json_schema`/`unsupported` error.
- Cross-provider fallback via `runWithFallback` order `[primary, ...rest]`.
- Per-request `provider`/`model` overrides forwarded to `chatDetailed` opts.
- `max_completion_tokens` via shared `buildMaxCompletionTokens(primaryContextWindow, system+user, 32768)`.

### System prompt (from grilling Q7, Q8, Q10, Q12)

The system prompt instructs:
- 7-phase slide structure: `title → objectives → motivation → 3-4 content → activity → checkForUnderstanding → closing` (25-30 slides total)
- One session only (the provided session's content)
- 30% text / 70% visual space per slide (max 5 bullets, generous margins)
- Student-facing bullets (never teacher stage directions from `flow`)
- `speakerNotes` on content/activity slides drawn from `flow` paragraph (ADR-0006)
- `imagePrompt` populated with concise visual descriptions on content/activity slides; `null` on title/objectives/closing
- `motivation` slide: hook/engagement activity synthesized from `learnerContext` + `flow` opening
- Distinct headings per slide
- Generously enrich content (add pedagogical detail, examples, visual descriptions — not just restructure)

### User prompt

- Filtered JSON: one session's `learningObjectives`, `learnerContext`, `flow`, `formativeAssessment`, `extendedLearningOpportunities` + `meta.lessonTitle` + `meta.numberOfSessions`
- `Expected slides: 25-30`
- `Deck title: {lessonTitle}`

### Validation + retry (from grilling Q8)

- `SlideDeckSpecSchema.parse` after `JSON.parse` of model output
- On first `ZodError`: retry once with `Previous output failed validation:\n - {path}: {message}` appended to user message
- On second success: `retried: true`, return binary PPTX
- On second failure: `502 { error, validationErrors, raw: content.slice(0, 8192), provider, model }`
- On fatal chain failure: `502` with trimmed raw

### `SystemFields` type (assembly spec §3)

```
type SystemFields = {
  teacherName: string | null;
  sectionLabel: string | null;
  gradeLevel: string;           // from extraction
  learningArea: string;         // from extraction
  generationMetadata: {        // built post-call
    provider: string;
    model: string;
    generatedAt: string;        // ISO timestamp
  };
  bowReference: string;        // system-templated default "DepEd BOW — {termLabel}, {weekLabel}"
};
```

### Architectural decisions

- **ADR-0006 (slide content from lesson plan):** Structurally enforced — the route accepts `lessonPlan` in the body, never sees the BOW extraction's content. The extraction is only used for `systemFields` (`gradeLevel`, `learningArea`).
- **ADR-0002 (provider registry):** All AI calls through `chatDetailed` via registry. No hardcoded client.
- **ADR-0003 (no Postgres):** No `packages/db` imports in studio.
- **ADR-0001 (Node runtime):** pptxgenjs needs Node's Buffer/file system. Route runs on Fly.io.
- **Assembly spec §5.2 (speaker notes):** `flow` → `speakerNotes`, not slide bullets. Student-facing content is a separate, condensed generation.
- **Assembly spec §5.4 (pptxgenjs notes):** `LAYOUT_WIDE`, fresh options per slide, `bullet: true`, `addNotes()` for speaker notes, no `#` in hex, one `new pptxgen()` per file.
- **`TODO(ADR-0008):`** `extractionId` is still a file-hash alias. Normalized-text hash + durable `api/bow_documents` deferred to Phase 5.
- **`TODO(Phase 2):`** Image adapter — `imagePrompt` is populated but assembler renders whitespace.
- **`TODO(manual e2e):`** Install `markitdown` + `soffice` + `pdftoppm` for visual QA at the manual e2e checkbox.

## Testing Decisions

### What makes a good test

Only test external behavior, not implementation details. The tests should verify that the route returns the right status codes, content types, and response shapes for given inputs — not how the prompt is constructed internally or how pptxgenjs renders internally. Mocks should be at the boundary (`chatDetailed`, `extractionCache`, `primaryContextWindow`), not at internal helper functions.

### Seam 1 — `packages/schemas/src/slide-deck.test.ts` (unit)

Zod validation of `SlideDeckSpecSchema`. Tests:
- Valid 25-slide fixture (title + objectives + motivation + 3-4 content + activity + check + closing per one session) passes
- Invalid layout value rejects with path containing `layout`
- Missing `speakerNotes` on a `content` slide rejects
- `imagePrompt: null` on a `title` slide passes
- Missing `heading` on any slide rejects

Prior art: `packages/schemas/src/lesson-plan.test.ts` (same pattern — valid fixture, invalid field rejection with path check).

### Seam 2 — `apps/studio/src/routes/slides.test.ts` (integration, highest seam)

`POST /api/slides/generate` via `app.request()` with `vi.hoisted` mocks (`mockedExtractionCache`, `windowHolder=128_000`, `mockedChatDetailed`). Tests:
- `410` when `extractionId` not in cache (EXTRACTION_EXPIRED)
- `400` when `lessonPlan` fails `LessonPlanResponseSchema` validation
- `404` with `availableSessions` when `sessionLabel` not found
- `dryRun: true` returns prompts/budget without calling `chatDetailed`
- Happy path: `200` binary PPTX, `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`, `Content-Disposition: attachment`, `X-Provider`/`X-Model`/`X-Retried`/`X-Generated-At` headers set
- `retried: true` when first output fails validation and second passes (`X-Retried: true`)
- `502` with `validationErrors` + trimmed `raw` when both attempts fail
- `provider`/`model` overrides forwarded to `chatDetailed` (check mock call args)
- `sessionLabel` override selects right session (verify via prompt content or mock call)
- `systemFields` null → title slide uses `TEACHER_FILL_BLANK` (verify via assembled PPTX content, if testable through the mock)

Prior art: `apps/studio/src/routes/lesson-plan.test.ts` (same `vi.hoisted` mock pattern, same `app.request()` integration style).

### Seam 3 — `apps/studio/src/lib/pptx.test.ts` (unit)

`assemblePptx(slideDeck, systemFields)` pure function. Tests:
- Given a valid `SlideDeckSpec` fixture (minimal: 1 title + 1 content slide), produces a non-empty `Buffer`
- Buffer is a valid PPTX (pptxgenjs `write` doesn't throw; buffer starts with PK zip signature)
- Title slide contains `lessonTitle` text
- Content slides have `speakerNotes` set (verified via pptxgenjs internal slide object, not the binary output)
- `teacherName: null` → title slide contains `TEACHER_FILL_BLANK` text

Prior art: `apps/studio/src/lib/tokens.test.ts` (pure function unit test pattern).

### Verification commands

```bash
pnpm --filter @eduksource/schemas exec vitest run src/slide-deck.test.ts
pnpm --filter @eduksource/studio exec vitest run src/routes/slides.test.ts src/lib/pptx.test.ts
pnpm lint
pnpm check-types
pnpm build:packages
```

## Out of Scope

- **Image generation** — `imagePrompt` is populated but no image adapter is wired. Phase 2 adds the image provider + rendering.
- **Visual QA tooling** — `markitdown`, `soffice`, `pdftoppm` not installed. Automated placeholder scanning + visual rendering deferred to the "Manual end-to-end test" checkbox (`docs/plan.md:52`).
- **R2 upload** — The route returns binary; admin handles R2 upload + `POST /internal/products` (Phase 5).
- **DOCX generation** — Next checkbox (`docs/plan.md:50`), not this slice. `studio-constants.ts` is landed now for forward-compat.
- **Summative/term test** — Separate checkbox (`docs/plan.md:51`).
- **Async job queue** — Phase 2 Track B if blocking latency demands it.
- **Service-token hardening** — `x-internal-token` warns only (Phase 2 hardens to `401`).
- **`TaskType: 'slides'`** — Not added; uses `TaskType: 'lesson_plan'` per grilling Q8 (same model, enriches content).
- **`studio-constants.ts` DOCX usage** — Constants are defined but only consumed by the DOCX generator (next checkbox).
- **Letterhead** — Deferred per assembly spec §4.1.
- **Multi-session decks** — One session only per grilling Q7/Q11. Multi-session decks are not a Phase 1 requirement.

## Further Notes

- The `SlideDeckSpec` type from assembly spec §5.1 is the source of truth for the schema shape, with the addition of `'motivation'` to the layout union (grilling Q12).
- The `SystemFields` type from assembly spec §3 is the source of truth for system fields. `generationMetadata` is built post-call (provider/model from result, `generatedAt` = `new Date().toISOString()`).
- The `assemblePptx` function follows pptxgenjs implementation notes from assembly spec §5.4: `LAYOUT_WIDE`, fresh options per slide, `bullet: true` per item, `addNotes()` for speaker notes, no `#` in hex, one `new pptxgen()` per file.
- The `bowReference` defaults to `"DepEd BOW — {termLabel}, {weekLabel}"` (system-templated from request, not AI-generated).
- Token budget: 25-30 slides × ~200-400 chars/slide ≈ 10,000-15,000 chars output ≈ 13,000-19,500 tokens. Input (one session's LP + system prompt) ≈ 5,000-6,000 tokens. Total ≈ 18,000-25,500 tokens — well within 128k window and 32,768 ceiling.
- The route is mounted at `/api/slides` (not `/api/lesson-plans/:id/slides`) because it's a standalone generation endpoint, not a sub-resource of lesson plans. The lesson plan is an input, not a parent resource.
- The `SlideDeckSpec` is internal to the route+assembler — it's never returned as JSON. The shared schema exists for forward-compat with `AssemblyInput` (assembly spec §3) and admin preview rendering.
- `pptxgenjs` version: `^4.0.1` (latest, confirmed via `npm view`).

---
Provenance: GitHub issue https://github.com/jeius/eduksource-ph/issues/6 (id 5267404412) created via mcpproxy github:issue_write method:create owner:jeius repo:eduksource-ph on 2026-08-25.
