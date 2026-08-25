Status: ready-for-agent

## Problem Statement

Teachers (Grade 1–12, Life and Career Skills and other learning areas) need DepEd BOW-aligned lesson plans that look and read like real DLLs — not outline dumps. Today Studio can extract a BOW PDF into structured objectives (`POST /api/extract`), but an editor cannot yet turn a scoped BOW week into a classroom-ready lesson plan without writing the Intentions / Learning Experience / Assessment / Ways Forward sections by hand. The next unchecked Phase 1 Track B box (`docs/plan.md:48` — *"Lesson plan generation route: prompt design + structured JSON output"*) exists precisely to close that gap before PPTX/DOCX assembly (`docs/specs/2026-08-17-lesson-output-assembly-design.md`) and exam generation are built. The template `LP_Template_for_Orientations.pdf` defines what each section is *for*; the examples `ValEd_DLL_Week_1.pdf` / `ValEd_DLL_Week_9.pdf` define the quality bar the generator must approach — 3 distinct objectives per session, per-session Learner Context + Flow + Resources, varied formative assessments across sessions, genuine cross-subject integration or literal `N/A`, reflections always blank. Without this route, the Studio pipeline stops at extraction and the Phase 1 exit criteria (*one BOW PDF → all four outputs locally*) cannot be met.

## Solution

Add a synchronous, lesson-plan-only generation route in Studio that turns a cached BOW extraction's single week-block into a structured `LessonPlanResponse` matching the DepEd template's fields. The editor calls `POST /api/lesson-plans/generate` with an `extractionId` (file-hash alias for this slice, migrated to ADR-0008 normalized-text hash later), a `termLabel`, a `weekLabel`, and optional `sessionsOverride` / per-call `provider` / `model` / `dryRun` harness. Studio scopes the extraction to that one week-block (block overrides term as already modeled in `ExtractResponse`), builds a system prompt from `LP_Template_for_Orientations.pdf`'s Learning Design Principles plus hard null-guards and a user prompt from the filtered slice plus a one-session exemplar (quality > cost), calls the swappable provider registry (`TaskType: lesson_plan`) with `response_format: json_schema` and a prose fallback, validates against a shared Zod schema in `packages/schemas`, retries once with validation errors on failure, and returns `{ lessonPlan, generationMetadata }` (or a `dryRun` prompt preview). Errors distinguish a stale extraction (`410 Gone`) from an unknown term/week (`404` with enumerated available labels). This route is generation only — it does not assemble DOCX/PPTX, persist to Postgres, or introduce a job queue.

## User Stories

1. As an admin/editor, I want to generate a lesson plan for a specific BOW term and week without re-uploading the PDF, so that I can reuse a BOW across multiple weeks efficiently.
2. As an admin/editor, I want to request the lesson plan for `First Term / Week 1 to 2 (10 days)` with 4 sessions and get 12 distinct objectives (3 per session), so that each session column in the eventual DOCX is not copy-pasted.
3. As an admin/editor, I want the generated lesson plan to have per-session Learner Context that reflects that session's prior knowledge and barriers, so that lessons connect to learners' evolving context per the template.
4. As an admin/editor, I want each session's Flow to be teacher-facing stage directions (wellness check, objective-setting, guided activity, collaboration, summarization) that implicitly embed the 7 Learning Design Principles, so that another teacher can implement the lesson without extra explanation.
5. As an admin/editor, I want `opportunitiesForIntegration` to be a genuine cross-subject link per session or the literal string `N/A`, so that the lesson does not pad integration to look more complete than it is.
6. As an admin/editor, I want `reflections` to always be `null` and never generated, so that the teacher fills it after delivery and the AI does not hallucinate post-lesson notes.
7. As an admin/editor, I want the route to never invent `teacherName`, `sectionLabel`, dates, or timetable blocks, so that system-known and scheduling data stay out of the AI output.
8. As an admin/editor, I want `Learning Competency and Curriculum Standards` to carry the BOW's `contentStandard` / `performanceStandard` / `learningCompetency` for that block, so that the Intentions row is curriculum-faithful.
9. As an admin/editor, I want `numberOfSessions` to default to that block's `durationDays` and be overridable via `sessionsOverride` (1–7), so that weeks with `null`/`*` duration or compressed schedules still work.
10. As an admin/editor, I want `referencesFromBow` to contain AI-suggested references (e.g. Quexbook, Verywell Mind) while the system BOW citation is appended at DOCX assembly time, so that citations stay traceable.
11. As an owner, I want to preview the constructed system + user prompt without spending an LLM call (`dryRun: true`), so that I can A/B the same prompt across NIM vs OpenRouter vs Opencode Go before committing.
12. As an owner, I want to override `provider` and `model` per request, so that I can try a cheaper model for lesson-plan reshaping while keeping a stronger model for exam generation.
13. As an owner, I want lesson-plan calls to go through the swappable provider registry with cross-provider fallback (primary → remaining configured providers), so that a flaky NIM at peak hours does not block the editor.
14. As an editor, I want structured-output failures to be retried once automatically with the validation errors shown to the model, so that transient schema drifts do not surface as 500s while prompt tuning is active.
15. As an editor, I want a malformed retry to return `502 Bad Gateway` with the raw model output (trimmed) and validation errors plus `generationMetadata { provider, model, retried: true }`, so that prompt tuning can be debugged from the response rather than server logs alone.
16. As an editor, I want a missing or expired `extractionId` to return `410 Gone` with a message to re-run `/extract`, so that a stale cache does not silently generate against the wrong BOW.
17. As an editor, I want an unknown `termLabel` or `weekLabel` to return `404` listing `availableTerms` / `availableWeeks`, so that the admin UI can offer a picker instead of a raw error.
18. As a developer, I want token budgeting to reuse extraction's `estimateTokens = ceil(chars * 1.3)` and `maxCompletionTokens = min(32_768, max(1, floor(window*0.8) - estimateTokens))`, so that long Flows do not truncate at the provider's output cap.
19. As a developer, I want the shared `LessonPlanResponse` schema to live in `packages/schemas`, so that DOCX/PPTX assembly (`AssemblyInput` per `2026-08-17-lesson-output-assembly-design.md:3`) can import it without drift.
20. As a developer, I want Lesson Plan generation to stay synchronous (blocking `200`) for Phase 1, so that the pipeline does not introduce queue/ polling state machines before latency data justifies them.

## Implementation Decisions

- **Modules built/modified**
  - New shared schema in `packages/schemas` for `LessonPlanResponse` (and re-export via the package barrel) — the only source of truth consumed by both generation and later DOCX assembly. Studio-local `src/schemas/lesson-plan.ts` is not used.
  - New route in Studio under `/api/lesson-plans/generate` mounted alongside `POST /api/extract` (parity), plus a small shared helper for `estimateTokens` / `buildMaxCompletionTokens` extracted from extraction's existing helpers so both routes use the same budget math.
  - No new `packages/db` or `apps/api` changes in this slice; durable `bow_documents` wiring stays Phase 5 (`Studio → R2 → POST /internal/products`, ADR-0003). The `extractionId` alias `TODO(ADR-0008)` is left as a comment + logger field.

- **API contract (prototype is the contract)**

  ```ts
  // POST /api/lesson-plans/generate
  type GenerateLessonPlanRequest = {
    extractionId: string;        // file-hash alias this slice; normalized-text hash after ADR-0008 migration
    termLabel: string;           // exact match against ExtractResponse.document.terms[].termLabel
    weekLabel: string;           // exact match against term.blocks[].weekLabel
    sessionsOverride?: number;   // 1–7, defaults to block.durationDays ?? 1
    provider?: string;           // per-call override of AI_PROVIDER
    model?: string;              // per-call override of AI_MODEL_LESSON_PLAN
    dryRun?: boolean;            // true → return { systemPrompt, userPrompt, estimatedTokens, maxCompletionTokens, provider, model }, no LLM call
  };
  type GenerateLessonPlanResponse = {
    lessonPlan: LessonPlanResponse;
    generationMetadata: { provider: string; model: string; generatedAt: string; retried: boolean };
  };
  // Errors: 410 Gone { code: "EXTRACTION_EXPIRED", error } for missing extractionId
  //         404 Not Found { error, availableTerms?: string[], availableWeeks?: string[] }
  //         502 Bad Gateway { error, validationErrors, raw, provider, model } after retry failure
  //         413/400 for sessionsOverride out of range, malformed body (Zod)
  ```

- **Context scoping (`buildLessonPlanContext`)**
  - Filtered week slice, not full BOW fallthrough: pick `term = document.terms.find(termLabel)` then `block = term.blocks.find(weekLabel)`. Return `{ learningArea, gradeLevel, contentStandard: block.contentStandard ?? term.contentStandard ?? [], performanceStandard: block.performanceStandard ?? term.performanceStandard ?? [], skillsFocus: block.skillsFocus ?? term.skillsFocus ?? null, strands: block.strands, suggestedActivities: term.suggestedActivities ?? [], suggestedPerformanceTasks: term.suggestedPerformanceTasks ?? [], durationDays: block.durationDays ?? 1, extractionNotes: block.extractionNotes }`. Block overrides term when present, matching `ExtractResponse` nullability. `numberOfSessions = sessionsOverride ?? durationDays ?? 1`.

- **Prompt design**
  - System prompt lifts `LP_Template_for_Orientations.pdf` P2–P3 pedagogy verbatim (Learning Design Principles bullets + Assessment/Ways Forward guidance) plus a closing guard block: *System fields NOT available: teacherName, sectionLabel, dates, schedule, reflections, signature block. If no genuine cross-subject link exists for a session, output exactly "N/A". Never populate reflections.* The template's Reflection section explicitly states reflections are teacher-filled after delivery — the guard is belt-and-suspenders to the `z.null()` schema.
  - User prompt = filtered context JSON + `Expected sessions: N` + one-session exemplar (Week 1 S1: its 3 objectives, Learner Context sentence, and Flow excerpt *"The teacher presents lesson objectives … Activity: How well do you know yourself? … peer sharing 2 min"* — quality > cost, ~500 tokens — with an explicit instruction to produce *N distinct sessions* (distinct objectives with observable verbs, distinct Learner Context, distinct Flow sequences, varied Formative Assessments rotating MCQ / short-answer / scenario-based / reflective across sessions; do not copy-paste a session's content into another).

- **Provider & token budgeting (ADR-0002)**
  - All calls go through `apps/studio/src/lib/ai` registry (`TaskType: lesson_plan`, per-task `AI_MODEL_LESSON_PLAN` override). `response_format: json_schema` (OpenAI-compatible `json_schema`) as primary; on `400`/unsupported error, fall back once to prose instruction `Return only valid JSON…` (OpenAI SDK is the client either way — confirmed compatible for NIM/OpenRouter/Opencode Go per `docs/architecture.md:3`). Budget via shared `buildMaxCompletionTokens(primaryContextWindow, systemPrompt+userPrompt)` with `MAX_OUTPUT = 32_768` and the `1.3×` / `0.8` ratios extracted from extraction. Cross-provider fallback chain is the registry's `runWithFallback` order `[primary, ...rest]`; `dryRun` bypasses it entirely.

- **Output schema & validation (prototype trimmed to decision)**

  ```ts
  // packages/schemas/src/lesson-plan.ts — shared with assembly's AssemblyInput
  type LessonPlanResponse = {
    meta: { lessonTitle: string; numberOfSessions: number; referencesFromBow: string[] };
    intentions: {
      learningCompetencyAndStandards: { contentStandard: string[]; performanceStandard: string[]; learningCompetency: string };
      sessions: { sessionLabel: string; learningObjectives: string[]; learnerContext: string }[];
    };
    learningExperience: {
      sessions: { sessionLabel: string; preLesson: string; flow: string; learningResources: string[]; opportunitiesForIntegration: string }[];
    };
    assessment: { sessions: { sessionLabel: string; formativeAssessment: string }[] };
    waysForward: { sessions: { sessionLabel: string; extendedLearningOpportunities: string; reflections: null }[] };
  };
  ```

  - Permissive prose strings (`z.string().min(10-20)`) so a 5-question markdown assessment fits; `reflections: z.null()` is strict (rejects any string); `opportunitiesForIntegration: z.string()` allows a sentence or exactly `"N/A"` (guarded in prompt, not in schema — avoids coupling validation to one literal). `referencesFromBow: z.array(z.string())` allows URLs and plain titles (no `url()` validation — editor review per open item in `2026-08-17-lesson-plan-generation-design.md:10`).
  - Validate with that Zod before returning. On `ZodError`: retry once with `Previous output failed validation:\n - ${path}: ${msg}` appended to the user message (same shape as extraction's `Previous output failed JSON parse:` retry). Set `retried = true` if retry fired. Second failure → `502` with `validationErrors` (Zod error paths), `raw` trimmed to 8 KB, plus `provider`/`model`.

- **Auth & runtime (ADR-0001)**
  - Node on Fly as existing Studio (no Workers move). Route stays open for Phase 1 dev but logs `logger.warn` if `x-internal-token` is absent (Phase 2 hard-enables `401` per `docs/plan.md:68` internal service-token auth item). No Postgres import in Studio (ADR-0003).

- **Sequencing & out-of-scope plumbing (ADR-0006)**
  - `SlideDeckSpec` generation (PPTX) is a separate, *downstream* call chained off this route's output (`LessonPlanResponse → SlideDeckSpec`), not run in parallel off the BOW. This route only produces the DOCX-facing lesson plan; slide generation and `AssemblyInput` → DOCX/PPTX assembly (with `SystemFields.teacherName/sectionLabel/bowReference/generationMetadata` added at assembly time) are the next slices.

## Testing Decisions

- **What makes a good test:** test external HTTP behavior via `app.request()`, not provider internals or prompt strings. Assert status codes, envelope shapes (`lessonPlan`, `generationMetadata.retried`), `ZodError` paths on 502, and error bodies match contracts; do not assert on prompt substrings. Only test external behavior, not implementation details. Follow the `apps/studio/src/routes/extract.test.ts` mock pattern (mock `../lib/ai/client.js` `chatDetailed` and `../lib/cache.js` `extractionCache` via `vi.hoisted`, assert via `createLessonPlanRoutes()` mounted on a test `Hono`).

- **Which modules will be tested — ideal is one high seam, second only for the shared contract:**
  - **Seam 1 (highest, primary): `POST /api/lesson-plans/generate` HTTP integration** — single seam that covers scoping, prompt construction, provider fallback, validation/ retry, and error bodies. Cases: happy path produces `N` distinct sessions with `numberOfSessions` following `sessionsOverride ?? durationDays`, `dryRun` returns prompts without calling `chatDetailed`, `retried:true` when first `chatDetailed` return breaks validation and second passes, `502` with trimmed `raw` when both fail, `410` for unknown/expired `extractionId`, `404` with `availableWeeks/availableTerms` for wrong `termLabel`/`weekLabel`, `400/413` for out-of-range `sessionsOverride`, `provider`/`model` overrides reach `chatDetailed` (checked via mock args), `opportunitiesForIntegration` literal `N/A` passes, `reflections != null` fails into retry.
  - **Seam 2 (lower, needed): `packages/schemas/src/lesson-plan.ts` Zod unit** — minimal, because DOCX/PPTX assembly will import the schema directly without going through HTTP. Cases: valid fixture shaped like `ValEd_DLL_Week_1` (4 sessions, 3 objectives/session) passes; `reflections: "text"` rejects with path `waysForward.sessions[0].reflections`; `formativeAssessment` empty rejects; numberOfSessions type mismatch rejects. Prior art: `apps/studio/src/schemas/extract.test.ts` is the local-schema prior; no `packages/schemas` schema tests exist yet so this is the first of that kind.

- **Prior art:** `apps/studio/src/routes/extract.test.ts` + `extract.patterns.test.ts` (mocked AI + cache, 20-page/10MB guards, `validDoc` fixture), `apps/studio/src/lib/ai/providers.test.ts` and `client.test.ts` (registry resolution), `health.test.ts` (liveness + provider probe). This slice reuses the same `vi.hoisted` mocks and `windowHolder` pattern for `primaryContextWindow`.

## Out of Scope

- Durable `extractionId` (normalized-text hash + `api` `POST /internal/bow-documents` write) — `TODO(ADR-0008)` migration; this slice uses file-hash alias in-memory only. Also R2 upload of extraction JSON/PDF and BOW monitor pipeline (`workflows/bow-monitor.md`).
- PPTX/DOCX assembly (`2026-08-17-lesson-output-assembly-design.md`) — `AssemblyInput`, `SystemFields` (`teacherName`/`sectionLabel`/`bowReference`), `SlideDeckSpec` generation (ADR-0006), `pptxgenjs` / `docx` builders, letterhead, signature block, self-check rubric page, `TEACHER_FILL_BLANK` / `TEACHER_FILL_NOTE` constants.
- Summative/term exam generation route and the `summative_test` registry task.
- `apps/api` `POST /internal/products` product draft creation, versioning, and `admin` review/publish workflow (`workflows/material-pipeline.md` checkpoint) — Phase 5 integration.
- BetterAuth / `admin↔studio` service-token hard enforcement, rate limiting, job-queue / async flow — Phase 2 (`docs/plan.md:62-70`) remaining items.
- Search (`apps/search`, ADR-0009), BOW Parsing extraction service (`apps/extraction`, ADR-0011 parked), `apps/store` / `apps/admin` / `apps/docs` / `packages/{ui,auth,email}`.

## Further Notes

- **Seam check (per `to-spec` step 2):** proposed seams are Seam 1 HTTP (`POST /api/lesson-plans/generate`) as the single primary seam plus Seam 2 Zod in `packages/schemas`. Please confirm these match your expectations before agent dispatch — the intent is one high seam; the second exists only because the schema is consumed outside Studio (DOCX/PPTX). If you prefer strict one-seam, the Zod tests can be folded as unit cases under `apps/studio/src/schemas/lesson-plan.test.ts` instead.
- All Studio invariants from `apps/studio/AGENTS.md` apply: registry-only AI calls, no `packages/db` imports, `env.ts` for every key, `logger` is `@eduksource/logger` (loglayer) — not `console.log` — and diagnostics that must not corrupt streams go to `stderr`.
- Open items carried forward from `2026-08-17-lesson-plan-generation-design.md:10`: verify `response_format: json_schema` parity across all three providers (deferred, prose fallback covers it for now); caching store for multi-instance Studio; whether `referencesFromBow` URLs need fetch-validation before showing to editor (left as editor-review concern).
- The `LP_Template_for_Orientations.pdf` letterhead and signature/rubric blocks are system concerns resolved at DOCX assembly time (`2026-08-17-lesson-output-assembly-design.md:4`), not by this generation route.


---
Provenance: GitHub issue https://github.com/jeius/eduksource-ph/issues/4
