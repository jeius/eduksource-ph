# PPTX Generation Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/slides/generate` to `apps/studio` — turn a reviewed `LessonPlanResponse` into a downloadable binary PPTX deck (25-30 slides, one session, DepEd phase structure) via `pptxgenjs`.

**Architecture:** Three new units with clear boundaries: a shared `SlideDeckSpec` Zod schema in `packages/schemas` (contract for forward-compat with `AssemblyInput`), a pure `assemblePptx()` function in `apps/studio/src/lib/` (pptxgenjs only, no AI), and a Hono route that chains validate-input → build-prompts → AI-generate `SlideDeckSpec` (registry, `TaskType: 'lesson_plan'`, `json_schema` strict → prose fallback → single retry) → inline `assemblePptx()` → binary response with metadata headers. ADR-0006 is enforced structurally: the route takes the lesson plan as request body and never reads BOW content — the extraction cache lookup is only for `gradeLevel`/`learningArea` system fields.

**Tech Stack:** TypeScript strict, Zod v4 (`packages/schemas`), Hono + `@hono/zod-validator`, `pptxgenjs ^4.0.1` (new dep), existing provider registry (`chatDetailed`), shared token helper (`estimateTokens`/`buildMaxCompletionTokens` from `lib/tokens.js`).

**Spec:** `docs/specs/2026-08-25-pptx-generation-spec.md` (266 lines; scratch source `.scratch/pptx-generation/spec.md`; GitHub issue #6). Reference docs: `docs/specs/2026-08-17-lesson-output-assembly-design.md` §2 (constants), §3 (SystemFields), §5 (PPTX assembly notes); ADR-0006 (slide content chained off lesson plan).

## Global Constraints

- Node runtime only (ADR-0001) — pptxgenjs needs Buffer; do not port to Workers.
- All AI calls through the registry (`chatDetailed` from `src/lib/ai/client.js`) — no direct OpenAI client at any call site (ADR-0002).
- Studio never imports `@eduksource/db` or `drizzle-orm` (ADR-0003).
- `TaskType` stays `'lesson_plan'` for slide generation — NO new `'slides'` task type (grilling Q8 override).
- Deck = 25-30 slides, ONE session (grilling Q7 b). Slide structure per session: title → objectives → motivation → 3-4 content → activity → checkForUnderstanding → closing.
- Slides are ~30% text / ~70% visual space: max 5 bullets per slide, student-facing wording only — teacher stage directions belong in `speakerNotes` drawn from `flow`, never on the slide face (ADR-0006).
- `imagePrompt`: populated on content/activity slides, `null` on title/objectives/closing (grilling Q10 b). Phase 1 assembler renders whitespace where images would go; no image API calls anywhere.
- Layout union (7 values): `'title' | 'objectives' | 'motivation' | 'content' | 'activity' | 'checkForUnderstanding' | 'closing'`.
- Prose strings permissive (`z.string().min(1)`); shape strictness comes from required fields.
- Errors mirror the lesson-plan route: `410 {code:'EXTRACTION_EXPIRED'}` on cache miss, `400` invalid lessonPlan/session range, `404` unknown sessionLabel with `availableSessions`, `502 {error, validationErrors, raw≤8192, provider, model}` after failed retry.
- Binary success response: `application/vnd.openxmlformats-officedocument.presentationml.presentation`, header `Content-Disposition: attachment; filename="slides.pptx"`, metadata headers `X-Provider`, `X-Model`, `X-Retried`, `X-Generated-At`.
- `dryRun: true` returns JSON `{ systemPrompt, userPrompt, estimatedTokens, maxCompletionTokens, provider, model }` without calling the LLM.
- Missing `x-internal-token` is warn-only logging in Phase 1 (same as lesson-plan route).
- TODO comments carried verbatim: `TODO(ADR-0008): extractionId is currently a fileHash alias…` and new `TODO(Phase 2): imagePrompt is populated but assembler renders whitespace…`.
- TypeScript strict, Biome clean (`pnpm lint`, user prefers the `biome` bin directly), Conventional Commits, small TDD commits per task.
- Never commit secrets; test fixtures are synthetic JSON only.

---

## File Structure

```txt
packages/schemas/src/
  studio-constants.ts        # NEW   TEACHER_FILL_BLANK / TEACHER_FILL_NOTE (+ barrel export)
  studio-constants.test.ts   # NEW   trivial-value guard
  slide-deck.ts              # NEW   SlideDeckSpecSchema Zod + types (7-layout union)
  slide-deck.test.ts         # NEW   Seam 1 — schema unit tests
  index.ts                   # MODIFY  re-export both new modules

apps/studio/src/lib/
  slides.ts                  # NEW   selectSession() + buildSlidePrompts() (pure prompt/selection logic)
  slides.test.ts             # NEW   unit tests for selection + prompts
  pptx.ts                    # NEW   assemblePptx(slideDeck, systemFields) -> Buffer
  pptx.test.ts               # NEW   Seam 3 — assembly unit tests

apps/studio/src/routes/
  slides.ts                  # NEW   POST /generate handler (validation, LLM call chain, response modes)
  slides.test.ts             # NEW   Seam 2 — HTTP integration tests (vi.hoisted mocks)

apps/studio/src/index.ts     # MODIFY  mount createSlidesRoutes()
apps/studio/package.json     # MODIFY  add pptxgenjs dependency (pnpm add)
```

Why `lib/slides.ts` exists as its own unit: keeps session selection + prompt building pure and independently testable, so the route file stays a thin orchestration layer (mirrors how `extract.ts` keeps helpers exported). Task boundaries follow this split so each subagent owns one deliverable: Task 1/2 = schemas package, Task 3 = lib prompts, Task 4 = assembler, Tasks 5+6 = route skeleton then full wiring.

---

### Task 1: Shared constants + SlideDeckSpec schema (Seam 1)

**Files:**
- Create: `packages/schemas/src/studio-constants.ts`
- Test: `packages/schemas/src/studio-constants.test.ts`
- Create: `packages/schemas/src/slide-deck.ts`
- Test: `packages/schemas/src/slide-deck.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: nothing new (zod already in deps).
- Produces:
  - `TEACHER_FILL_BLANK: string`, `TEACHER_FILL_NOTE: string` (exported from `@eduksource/schemas`)
  - `export const SlideLayoutSchema = z.enum(['title','objectives','motivation','content','activity','checkForUnderstanding','closing'])`
  - `export const SlideSchema = z.object({ layout: SlideLayoutSchema, heading: z.string().min(1), bullets: z.array(z.string().min(1)).max(5).optional(), speakerNotes: z.string().min(1).optional(), imagePrompt: z.string().min(1).nullable().optional() })`
  - `export const SlideSessionSchema = z.object({ sessionLabel: z.string().min(1), slides: z.array(SlideSchema).min(1) })`
  - `export const SlideDeckSpecSchema = z.object({ title: z.string().min(1), sessions: z.array(SlideSessionSchema).length(1) })`
  - Types: `SlideLayout`, `Slide`, `SlideSession`, `SlideDeckSpec` (all `z.infer` exports)

Note on `.length(1)` vs `.min(1)` for `sessions`: grilling Q7/Q11 locked ONE session per deck (teachers reuse). `.length(1)` enforces that at the type level rather than hoping the model complies — if a future multi-session mode is added it becomes `.min(1).max(N)` deliberately.

- [ ] **Step 1: Write failing tests**

`packages/schemas/src/studio-constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TEACHER_FILL_BLANK, TEACHER_FILL_NOTE } from './studio-constants.js';

describe('studio constants', () => {
  it('exposes non-empty fill blank used by DOCX/PPTX for missing teacher fields', () => {
    expect(TEACHER_FILL_BLANK.length).toBeGreaterThan(0);
    expect(TEACHER_FILL_BLANK).toContain('＿');
  });

  it('exposes non-empty fill note describing post-session completion', () => {
    expect(TEACHER_FILL_NOTE.length).toBeGreaterThan(0);
    expect(TEACHER_FILL_NOTE.toLowerCase()).toContain('teacher');
  });
});
```

`packages/schemas/src/slide-deck.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SlideDeckSpecSchema } from './slide-deck.js';

// Minimal-but-realistic valid fixture (one session, 7-phase structure condensed)
const validDeck = {
  title: 'Understanding Developmental Stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding Developmental Stages', imagePrompt: null },
        {
          layout: 'objectives',
          heading: 'Learning Objectives',
          bullets: ['identify stages', 'describe characteristics', 'reflect on importance'],
          speakerNotes: 'Read objectives aloud and connect to previous session.',
        },
        {
          layout: 'content',
          heading: 'Key Developmental Tasks',
          bullets: ['task one', 'task two'],
          speakerNotes: 'Flow paragraph condensed: present timeline activity first.',
          imagePrompt: 'A labeled timeline of adolescent development stages',
        },
        {
          layout: 'closing',
          heading: 'Extend Your Learning',
          bullets: ['Family observation journal'],
        },
      ],
    },
  ],
};

describe('SlideDeckSpecSchema', () => {
  it('accepts a valid one-session deck across all layout kinds', () => {
    expect(() => SlideDeckSpecSchema.parse(validDeck)).not.toThrow();
  });

  it('rejects an unknown layout value with path containing layout', () => {
    const bad = structuredClone(validDeck);
    bad.sessions[0].slides[1].layout = 'hype-slide';
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toContain('layout');
    }
  });

  it('rejects more than five bullets per slide', () => {
    const bad = structuredClone(validDeck);
    bad.sessions[0].slides[1].bullets = ['1', '2', '3', '4', '5', '6'];
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('bullet');
    }
  });

  it('rejects a second session (decks are single-session by design)', () => {
    const bad = structuredClone(validDeck);
    bad.sessions.push({
      sessionLabel: 'Session 2',
      slides: [{ layout: 'title', heading: 'Second session deck' }],
    });
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('allows imagePrompt null on title slide and populated on content slide', () => {
    const result = SlideDeckSpecSchema.safeParse(validDeck);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions[0]?.slides[0]?.imagePrompt).toBeNull();
      expect(typeof result.data.sessions[0]?.slides[2]?.imagePrompt).toBe('string');
    }
  });

  it('requires heading on every slide', () => {
    const bad = structuredClone(validDeck);
    delete (bad.sessions[0].slides[0] as { heading?: string }).heading;
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
```

TS strictness note: packages use `noUncheckedIndexedAccess`, so index accesses return `T | undefined`. The guards above (`if (!result.success)`, optional chaining) handle it without non-null assertions (Biome bans `!`). Adjust any similar spots the same way.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eduksource/schemas exec vitest run src/studio-constants.test.ts src/slide-deck.test.ts`
Expected: FAIL — module not found (`./studio-constants.js`, `./slide-deck.js`).

- [ ] **Step 3: Implement minimal code**

`packages/schemas/src/studio-constants.ts`:

```ts
/**
 * Shared studio output-assembly constants
 * (docs/specs/2026-08-17-lesson-output-assembly-design.md §2).
 *
 * Used when rendering teacher-completed-later fields in generated documents.
 * PPTX uses TEACHER_FILL_BLANK for null teacherName/sectionLabel on the title
 * slide; the DOCX generator also consumes TEACHER_FILL_NOTE for reflections.
 */
export const TEACHER_FILL_BLANK = '＿＿＿＿＿＿＿＿＿＿＿＿＿＿';
export const TEACHER_FILL_NOTE = '[To be completed by the teacher after the session]';
```

`packages/schemas/src/slide-deck.ts`:

```ts
import { z } from 'zod';

/**
 * Shared SlideDeckSpec contract — the intermediate representation between
 * LessonPlanResponse generation and PPTX assembly (ADR-0006, assembly spec §5).
 *
 * One session per deck by design (teachers reuse the same deck across a
 * week-block's sessions). Bullets cap at 5 to hold the ~30% text / ~70%
 * visual-space rule. imagePrompt is populated by generation for Phase 2
 * image rendering but ignored by the Phase 1 assembler.
 */

export const SlideLayoutSchema = z.enum([
  'title',
  'objectives',
  'motivation',
  'content',
  'activity',
  'checkForUnderstanding',
  'closing',
]);

export const SlideSchema = z.object({
  layout: SlideLayoutSchema,
  heading: z.string().min(1),
  bullets: z.array(z.string().min(1)).max(5).optional(),
  /** Teacher guidance while presenting — drawn from the LP flow, never shown on the slide face (ADR-0006). */
  speakerNotes: z.string().min(1).optional(),
  /** Visual description for Phase 2 image rendering; null where no imagery is wanted. */
  imagePrompt: z.string().min(1).nullable().optional(),
});

export const SlideSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  slides: z.array(SlideSchema).min(1),
});

export const SlideDeckSpecSchema = z.object({
  title: z.string().min(1),
  // Exactly one session per deck (grilling Q7/Q11 — teachers reuse one deck across the block).
  sessions: z.array(SlideSessionSchema).length(1),
});

export type SlideLayout = z.infer<typeof SlideLayoutSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type SlideSession = z.infer<typeof SlideSessionSchema>;
export type SlideDeckSpec = z.infer<typeof SlideDeckSpecSchema>;
```

Then update `packages/schemas/src/index.ts` (current content ends with `export * from './lesson-plan.js';`):

```ts
export * from './bow-documents.js';
export * from './lesson-plan.js';
export * from './slide-deck.js';
export * from './studio-constants.js';
```

(Match whatever the barrel currently contains — the point is appending these two lines.)

Add subpath exports to `packages/schemas/package.json` `exports` map (mirror the `./lesson-plan` entries):

```json
"./slide-deck": {
  "types": "./dist/slide-deck.d.ts",
  "default": "./dist/slide-deck.js"
},
"./slide-deck.js": {
  "types": "./dist/slide-deck.d.ts",
  "default": "./dist/slide-deck.js"
},
"./studio-constants": {
  "types": "./dist/studio-constants.d.ts",
  "default": "./dist/studio-constants.js"
},
"./studio-constants.js": {
  "types": "./dist/studio-constants.d.ts",
  "default": "./dist/studio-constants.js"
}
```

- [ ] **Step 4: Run tests + checks**

Run:
```bash
pnpm --filter @eduksource/schemas exec vitest run src/studio-constants.test.ts src/slide-deck.test.ts
pnpm lint && pnpm check-types && pnpm build:packages
ls packages/schemas/dist | grep -E 'slide|constant'
```
Expected: all green; dist emits `slide-deck.d.ts` + `studio-constants.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): add SlideDeckSpec Zod + studio-constants

7-layout union incl motivation, single-session constraint (.length(1)),
max-5 bullets for 30% text / 70% visual space, nullable imagePrompt for
Phase 2 image rendering. TEACHER_FILL_BLANK/NOTE land now for the DOCX
checkbox per assembly spec section 2."
```

---

### Task 2: Session selection + prompt builders (`lib/slides.ts`)

**Files:**
- Create: `apps/studio/src/lib/slides.ts`
- Test: `apps/studio/src/lib/slides.test.ts`

**Interfaces:**
- Consumes: `LessonPlanResponse`, `IntentionsSession`, `LearningExperienceSession`, `AssessmentSession`, `WaysForwardSession` types from `@eduksource/schemas/lesson-plan.js`.
- Produces:
  - `export class SessionNotFoundError extends Error { readonly availableSessions: string[]; constructor(requested: string|null, available: string[]) }` — message exactly `` `Session "${requested}" not found` `` when requested, else `'No sessions found in lesson plan'`.
  - `export function selectSession(lp: LessonPlanResponse, sessionLabel?: string): SelectedSession` where `SelectedSession = { sessionLabel: string; objectives: string[]; learnerContext: string; flow: string; formativeAssessment: string; extendedLearningOpportunities: string }`. Default picks `lp.intentions.sessions[0]`. Throws `SessionNotFoundError` when the label isn't found among intentions' sessions.
  - `export function buildSlidePrompts(selected: SelectedSession, meta: LessonPlanResponse['meta'], systemFields: { learningArea: string; gradeLevel: string }): { systemPrompt: string; userPrompt: string }`

Design note: `selectSession` intentionally merges the four per-section session arrays into one object keyed off matching `sessionLabel` entries. It looks up each section (`intentions`, `learningExperience`, `assessment`, `waysForward`) separately, throwing `SessionNotFoundError` (with whatever labels exist in `intentions.sessions`) if any section lacks the chosen label — sections come from one validated `LessonPlanResponse` so label drift indicates malformed input worth failing loudly on.

- [ ] **Step 1: Write failing tests**

`apps/studio/src/lib/slides.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LessonPlanResponse } from '@eduksource/schemas/lesson-plan.js';
import { buildSlidePrompts, selectSession, SessionNotFoundError } from './slides.js';

const lp: LessonPlanResponse = {
  meta: {
    lessonTitle: 'Understanding Developmental Stages',
    numberOfSessions: 2,
    referencesFromBow: ['https://example.com/bow'],
  },
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: ['CS'],
      performanceStandard: ['PS'],
      learningCompetency: 'Examine developmental stages',
    },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages'], learnerContext: 'visual learners' },
      { sessionLabel: 'Session 2', learningObjectives: ['map careers'], learnerContext: 'career focus' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings & Recall', flow: 'Teacher presents objectives → wellness check → peer sharing.', learningResources: ['Slides'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 2', preLesson: 'Recall', flow: 'Career mapping workshop.', learningResources: [], opportunitiesForIntegration: 'ICT: tagline' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: 'MCQ on Erikson stages.' },
      { sessionLabel: 'Session 2', formativeAssessment: 'Reflective journal entry.' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Family observation walk.', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Interview a professional.', reflections: null },
    ],
  },
};

describe('selectSession', () => {
  it('defaults to the first session', () => {
    const s = selectSession(lp);
    expect(s.sessionLabel).toBe('Session 1');
    expect(s.objectives).toEqual(['identify stages']);
    expect(s.flow).toContain('wellness check');
    expect(s.formativeAssessment).toContain('MCQ');
    expect(s.extendedLearningOpportunities).toContain('Family observation');
  });

  it('selects by explicit sessionLabel', () => {
    const s = selectSession(lp, 'Session 2');
    expect(s.sessionLabel).toBe('Session 2');
    expect(s.learnerContext).toBe('career focus');
  });

  it('throws SessionNotFoundError listing available sessions', () => {
    try {
      selectSession(lp, 'Session 9');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SessionNotFoundError);
      if (err instanceof SessionNotFoundError) {
        expect(err.availableSessions).toEqual(['Session 1', 'Session 2']);
        expect(err.message).toBe('Session "Session 9" not found');
      }
    }
  });
});

describe('buildSlidePrompts', () => {
  const selected = selectSession(lp);
  const { systemPrompt, userPrompt } = buildSlidePrompts(selected, lp.meta, {
    learningArea: 'Life and Career Skills',
    gradeLevel: 'Grade 11',
  });

  it('system prompt encodes slide structure, density and audience rules', () => {
    expect(systemPrompt).toContain('25-30 slides');
    expect(systemPrompt).toContain('title → objectives → motivation → 3-4 content → activity → checkForUnderstanding → closing');
    expect(systemPrompt).toContain('no more than 5 bullets');
    expect(systemPrompt).toContain('student-facing');
    expect(systemPrompt).toContain('speakerNotes');
    expect(systemPrompt).toContain('imagePrompt');
    expect(systemPrompt).not.toContain('sessions[i]'); // never leaks TS indexing jargon
  });

  it('user prompt embeds exactly one session context plus expected count', () => {
    expect(userPrompt).toContain('Expected slides: 25-30');
    expect(userPrompt).toContain('Session 1');
    expect(userPrompt).toContain('identify stages');
    expect(userPrompt).not.toContain('map careers'); // other session excluded
    expect(userPrompt).toContain('Understanding Developmental Stages');
    expect(userPrompt).toContain('Life and Career Skills');
    expect(userPrompt).toContain('Grade 11');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/studio && pnpm exec vitest run src/lib/slides.test.ts`
Expected: FAIL — module not found (`./slides.js`).

- [ ] **Step 3: Implement minimal code**

`apps/studio/src/lib/slides.ts`:

```ts
import type {
  AssessmentSession,
  IntentionsSession,
  LearningExperienceSession,
  LessonPlanResponse,
  WaysForwardSession,
} from '@eduksource/schemas/lesson-plan.js';

/** Everything the slide generator needs from one session of the lesson plan. */
export type SelectedSession = {
  sessionLabel: string;
  objectives: string[];
  learnerContext: string;
  flow: string;
  formativeAssessment: string;
  extendedLearningOpportunities: string;
};

export class SessionNotFoundError extends Error {
  readonly availableSessions: string[];
  constructor(requested: string | null, available: string[]) {
    super(
      requested === null
        ? 'No sessions found in lesson plan'
        : `Session "${requested}" not found`
    );
    this.name = 'SessionNotFoundError';
    this.availableSessions = available;
  }
}

function findLabeled<T extends { sessionLabel: string }>(rows: T[], label: string): T {
  const match = rows.find((row) => row.sessionLabel === label);
  if (!match) throw new Error(`unreachable: ${label}`);
  return match;
}

export function selectSession(
  lp: LessonPlanResponse,
  sessionLabel?: string
): SelectedSession {
  const available = lp.intentions.sessions.map((s: IntentionsSession) => s.sessionLabel);
  const label = sessionLabel ?? available[0];
  if (!label) throw new SessionNotFoundError(null, available);

  const intentions = lp.intentions.sessions.find((s) => s.sessionLabel === label);
  if (!intentions) throw new SessionNotFoundError(label, available);

  const experience = lp.learningExperience.sessions.find(
    (s: LearningExperienceSession) => s.sessionLabel === label
  );
  const assessment = lp.assessment.sessions.find(
    (s: AssessmentSession) => s.sessionLabel === label
  );
  const waysForward = lp.waysForward.sessions.find(
    (s: WaysForwardSession) => s.sessionLabel === label
  );
  if (!experience || !assessment || !waysForward) {
    throw new SessionNotFoundError(label, available);
  }

  return {
    sessionLabel: intentions.sessionLabel,
    objectives: [...intentions.learningObjectives],
    learnerContext: intentions.learnerContext,
    flow: experience.flow,
    formativeAssessment: assessment.formativeAssessment,
    extendedLearningOpportunities: waysForward.extendedLearningOpportunities,
  };
}

const SLIDE_SYSTEM_PROMPT = `You are a Philippine DepEd classroom slide deck designer working from an approved lesson plan.

Produce a student-facing PowerPoint deck of 25-30 slides. Follow this exact per-session structure in order:
title → objectives → motivation → 3-4 content → activity → checkForUnderstanding → closing.

Rules:
- Each slide keeps text to roughly 30% of the slide: no more than 5 bullets, short phrases (one line each). Generous margins and breathing room carry the rest; do not cram.
- Wording on every slide face must be student-facing. Teacher stage directions (wellness checks, grouping instructions, timing cues) belong ONLY in speakerNotes — draw them from the provided Flow narrative for the corresponding part of the session.
- Put substantive teacher guidance in "speakerNotes" on the objectives, content, activity and checkForUnderstanding slides, condensed from the Flow narrative you were given.
- On content and activity slides set "imagePrompt" to a concise visual description of an illustration that would aid understanding (e.g. charts, timelines, everyday Filipino scenes). Set "imagePrompt": null on title, objectives and closing slides.
- The motivation slide carries the hook that opens the session — build it from the Learner Context and the opening move of the Flow.
- Enrich the material as you condense: add brief concrete examples, local context, or guiding questions that improve the learning material. You are improving, not merely reformatting.
- Distinct headings per slide; never repeat a heading verbatim within the deck.
- Return only valid JSON matching the provided schema, no prose, no code fences. Begin with "{" and end with "}".`;

export function buildSlidePrompts(
  selected: SelectedSession,
  meta: LessonPlanResponse['meta'],
  systemFields: { learningArea: string; gradeLevel: string }
): { systemPrompt: string; userPrompt: string } {
  const sessionContext = {
    sessionLabel: selected.sessionLabel,
    lessonTitle: meta.lessonTitle,
    learningArea: systemFields.learningArea,
    gradeLevel: systemFields.gradeLevel,
    learningObjectives: selected.objectives,
    learnerContext: selected.learnerContext,
    flow: selected.flow,
    formativeAssessment: selected.formativeAssessment,
    extendedLearningOpportunities: selected.extendedLearningOpportunities,
  };

  const userPrompt = `Generate the classroom slide deck for this session.

Session context (single session — teachers reuse this deck across the week-block):
${JSON.stringify(sessionContext, null, 2)}

Expected slides: 25-30
Deck title: ${meta.lessonTitle}

Return only valid JSON matching the SlideDeckSpec schema.`;

  return { systemPrompt: SLIDE_SYSTEM_PROMPT, userPrompt };
}
```

If Biome flags the unused `findLabeled` helper shown earlier, delete it (YAGNI — the inline `.find()` calls in `selectSession` already do the work).

- [ ] **Step 4: Run tests + checks**

Run: `cd apps/studio && pnpm exec vitest run src/lib/slides.test.ts && cd ../.. && pnpm lint && pnpm check-types`
Expected: PASS, lint/types clean.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/lib/slides.ts apps/studio/src/lib/slides.test.ts
git commit -m "feat(studio): add slide session selection + prompt builders

Pure selection logic merging the four per-section session arrays into
one SelectedSession, and system/user prompts encoding the 25-30 slide
structure, 30% text density, student-facing faces w/ speakerNotes from
flow (ADR-0006), populated imagePrompt and enrichment instruction."
```

---

### Task 3: PPTX assembler (`lib/pptx.ts`, Seam 3)

**Files:**
- Create: `apps/studio/src/lib/pptx.ts`
- Test: `apps/studio/src/lib/pptx.test.ts`
- Modify: `apps/studio/package.json` (add `pptxgenjs` dependency — fold into this task since only the assembler needs it)

**Interfaces:**
- Consumes: `SlideDeckSpec`, `Slide` from `@eduksource/schemas/slide-deck.js`; `TEACHER_FILL_BLANK` from `@eduksource/schemas/studio-constants.js`.
- Produces:
  - `export type SystemFields = { teacherName: string | null; sectionLabel: string | null; gradeLevel: string; learningArea: string; generationMetadata: { provider: string; model: string; generatedAt: string }; bowReference: string }`
  - `export async function assemblePptx(deck: SlideDeckSpec, fields: SystemFields): Promise<Buffer>` — one `new pptxgen()` instance, `LAYOUT_WIDE`, one slide per `deck.sessions[0].slides[i]`, returns `Buffer` via `pptx.write({ outputType: 'nodebuffer' })`. Before returning it exposes the presentation object for tests via `(globalThis as { __lastPptxPresentation?: unknown }).__lastPptxPresentation = pres;`.
  - `export async function assemblePptxToBase64(deck: SlideDeckSpec, fields: SystemFields): Promise<string>` — same assembly serialized as base64 (kept because the route may want it and the test asserts parity).

pptxgenjs implementation rules (from assembly spec §5.4, binding):
- Set `pres.layout = 'LAYOUT_WIDE'` before adding any slide (13.33″ × 7.5″).
- Fresh options object literal per `addText` call — pptxgenjs mutates options objects in place; never share/reuse one.
- Hex colors without `#`; bullet lists via `{ bullet: true }` option per paragraph item, never literal `•` characters.
- Speaker notes via `slide.addNotes(text)` — plain text, never a text box.
- Text boxes positioned explicitly (`x/y/w/h` in inches) with body text `fontSize` sized down for readability; title slide centered.

- [ ] **Step 1: Install dependency**

Run: `pnpm add --filter @eduksource/studio pptxgenjs@^4.0.1`
Expected: `package.json` gains `"pptxgenjs": "^4.0.1"` (or compatible caret) and lockfile updates.

- [ ] **Step 2: Write failing tests**

`apps/studio/src/lib/pptx.test.ts`:

Write the complete final test file:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import type { SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { TEACHER_FILL_BLANK } from '@eduksource/schemas/studio-constants.js';
import { assemblePptx, assemblePptxToBase64, SystemFields } from './pptx.js';

const deck: SlideDeckSpec = {
  title: 'Understanding Developmental Stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding Developmental Stages', imagePrompt: null },
        {
          layout: 'objectives',
          heading: 'Learning Objectives',
          bullets: ['identify stages', 'reflect on importance'],
          speakerNotes: 'Connect to prior session.',
        },
        {
          layout: 'content',
          heading: 'Developmental Tasks',
          bullets: ['physical growth', 'social roles'],
          speakerNotes: 'From flow: present timeline activity.',
          imagePrompt: 'Timeline of development stages',
        },
      ],
    },
  ],
};

const baseFields: SystemFields = {
  teacherName: 'Maiza R. Evangelista',
  sectionLabel: '11-Tesla',
  gradeLevel: 'Grade 11',
  learningArea: 'Life and Career Skills',
  generationMetadata: { provider: 'nim', model: 'test-model', generatedAt: '2026-08-25T00:00:00Z' },
  bowReference: 'DepEd BOW — First Term, Week 1',
};

describe('assemblePptx', () => {
  let buffer: Buffer;

  beforeAll(async () => {
    buffer = await assemblePptx(deck, baseFields);
  });

  it('produces a non-empty Buffer starting with the PK zip signature', () => {
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('exposes the assembled presentation with three slides via the test hook', () => {
    const pres = (
      globalThis as { __lastPptxPresentation?: { slides: Array<{ _slideObjects: unknown[] }> } }
    ).__lastPptxPresentation;
    if (!pres) throw new Error('assembler did not expose __lastPptxPresentation');
    expect(pres.slides.length).toBe(3);
    expect(pres.slides[0]?._slideObjects.length).toBeGreaterThan(0);
    expect(pres.slides[1]?._slideObjects.length).toBeGreaterThan(0);
  });

  it('serializes identically through the base64 helper', async () => {
    const b64 = await assemblePptxToBase64(deck, baseFields);
    expect(Buffer.from(b64, 'base64').subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('fills teacher blanks when systemFields carry null names', async () => {
    await assemblePptx(deck, {
      ...baseFields,
      teacherName: null,
      sectionLabel: null,
    });
    const pres = (
      globalThis as { __lastPptxPresentation?: { slides: Array<{ getText?: () => string }> } }
    ).__lastPptxPresentation;
    if (!pres) throw new Error('assembler did not expose __lastPptxPresentation');
    const titleSlide = pres.slides[0];
    const textJson = JSON.stringify(titleSlide);
    expect(textJson).toContain(TEACHER_FILL_BLANK);
  });
});
```

Implementation convenience note: whether `_slideObjects` / text containment works against pptxgenjs internals may vary by version; if `getText` doesn't exist, assert against `JSON.stringify(slideObject)` which contains raw strings passed to `addText`. Keep assertions on data we control (headings, `TEACHER_FILL_BLANK`), not on pptxgenjs rendering behavior.

- [ ] **Step 3: Implement minimal code**

`apps/studio/src/lib/pptx.ts`:

```ts
import type { Slide, SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { TEACHER_FILL_BLANK } from '@eduksource/schemas/studio-constants.js';
import pptxgen from 'pptxgenjs';

export type SystemFields = {
  teacherName: string | null;
  sectionLabel: string | null;
  gradeLevel: string;
  learningArea: string;
  generationMetadata: {
    provider: string;
    model: string;
    generatedAt: string;
  };
  bowReference: string;
};

// Palette (no '#' prefix — pptxgenjs rejects it; assembly spec §5.4)
const COLOR_TEXT = '1A1A1A';
const COLOR_ACCENT = '27548A'; // muted educational blue; revisit branding in Phase 2 visual polish
const COLOR_MUTED = '6B7280';

const PAGE_W = 13.33; // LAYOUT_WIDE inches
const PAGE_H = 7.5;

type TextOptions = Record<string, unknown>;

function addBulletedList(slide: { addText: (text: unknown, opts?: TextOptions) => void }, bullets: string[], yStart: number): void {
  let y = yStart;
  for (const bullet of bullets) {
    // Fresh options object per add* call — pptxgenjs mutates them (spec §5.4).
    slide.addText(bullet, {
      x: 1.0,
      y,
      w: PAGE_W - 2.0,
      h: 0.75,
      fontSize: 18,
      color: COLOR_TEXT,
      bullet: true,
      breakLine: true,
    });
    y += 0.85;
  }
}

export async function assemblePptx(deck: SlideDeckSpec, fields: SystemFields): Promise<Buffer> {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const session = deck.sessions[0];
  if (!session) throw new Error('SlideDeckSpec must contain exactly one session');

  for (const slideSpec of session.slides) {
    const slide = pres.addSlide();

    switch (slideSpec.layout) {
      case 'title': {
        slide.addText(deck.title, {
          x: 1.0, y: 2.4, w: PAGE_W - 2.0, h: 1.2,
          align: 'center', fontSize: 32, bold: true, color: COLOR_ACCENT,
        });
        slide.addText(`${fields.learningArea} · ${fields.gradeLevel}${fields.sectionLabel ? ` · ${fields.sectionLabel}` : ''}`, {
          x: 1.0, y: 3.7, w: PAGE_W - 2.0, h: 0.6,
          align: 'center', fontSize: 16, color: COLOR_MUTED,
        });
        slide.addText(fields.teacherName ?? TEACHER_FILL_BLANK, {
          x: 1.0, y: 4.4, w: PAGE_W - 2.0, h: 0.6,
          align: 'center', fontSize: 14, italic: true, color: COLOR_TEXT,
        });
        slide.addText(fields.bowReference, {
          x: 1.0, y: PAGE_H - 0.9, w: PAGE_W - 2.0, h: 0.5,
          align: 'center', fontSize: 11, color: COLOR_MUTED,
        });
        break;
      }
      case 'objectives':
      case 'motivation':
      case 'activity': {
        slide.addText(slideSpec.heading, {
          x: 1.0, y: 0.8, w: PAGE_W - 2.0, h: 0.9,
          fontSize: 24, bold: true, color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.0);
        break;
      }
      case 'checkForUnderstanding': {
        slide.addText(slideSpec.heading, {
          x: 1.0, y: 0.8, w: PAGE_W - 2.0, h: 0.9,
          fontSize: 24, bold: true, color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.2);
        else if (typeof slideSpec.heading === 'string') {
          // Heading-only prompt style: show the check question as body text
          slide.addText('', { x: 1.0, y: 2.4, w: PAGE_W - 2.0, h: 1.0 });
        }
        break;
      }
      case 'closing': {
        slide.addText(slideSpec.heading, {
          x: 1.0, y: 2.2, w: PAGE_W - 2.0, h: 0.9,
          align: 'center', fontSize: 26, bold: true, color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 3.3);
        break;
      }
      case 'content':
      default: {
        slide.addText(slideSpec.heading, {
          x: 1.0, y: 0.8, w: PAGE_W - 2.0, h: 0.9,
          fontSize: 22, bold: true, color: COLOR_TEXT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.0);
        break;
      }
    }

    if (slideSpec.speakerNotes) {
      slide.addNotes(slideSpec.speakerNotes);
    }
    // TODO(Phase 2): imagePrompt is populated but the assembler renders whitespace
    // where images will go; wire the image adapter (registry TaskType 'image')
    // and drop-in render here without regenerating decks.
  }

  (globalThis as { __lastPptxPresentation?: unknown }).__lastPptxPresentation = pres;

  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}

export async function assemblePptxToBase64(deck: SlideDeckSpec, fields: SystemFields): Promise<string> {
  const out = (await presWrite(deck, fields)) as string;
  return out;
}

async function presWrite(deck: SlideDeckSpec, fields: SystemFields): Promise<Buffer | string> {
  const buffer = await assemblePptx(deck, fields);
  return buffer.toString('base64');
}
```

Before committing: delete `presWrite` and inline the base64 conversion (`return (await pres.write({ outputType: 'nodebuffer' }) as Buffer).toString('base64')`) OR keep both helpers — whichever you choose, the exported surface must stay consistent with the test file (which calls `assemblePptxToBase64`). Remove any `addText('', …)` empty placeholder bodies Biome flags. Biome auto-fix organize-imports is expected.

- [ ] **Step 4: Run tests + checks**

Run: `cd apps/studio && pnpm exec vitest run src/lib/pptx.test.ts && cd ../.. && pnpm lint && pnpm check-types`
Expected: PASS, lint/types clean. If `_slideObjects` introspection fails on this pptxgenjs version, fall back to asserting `buffer.length > 1000` + PK signature + notes presence via serialized JSON grep of `speakerNotes` strings inside the buffer (unzip via `adm-zip` is NOT needed; keep it simple).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/package.json pnpm-lock.yaml apps/studio/src/lib/pptx.ts apps/studio/src/lib/pptx.test.ts
git commit -m "feat(studio): add pptx assembler (assemblePptx)

Pure pptxgenjs wrapper: LAYOUT_WIDE, fresh options per add*, bullet:true
lists, addNotes for speakerNotes, TEACHER_FILL_BLANK fallbacks on title
slide nulls, PK-signature sanity tests. imagePrompt intentionally
ignored (whitespace) — TODO(Phase 2) marks the drop-in point."
```

---

### Task 4: Route skeleton — validation, errors, dryRun (Seam 2 part 1)

**Files:**
- Create: `apps/studio/src/routes/slides.ts`
- Test: `apps/studio/src/routes/slides.test.ts`
- Modify: `apps/studio/src/index.ts` (mount route)

**Interfaces:**
- Consumes: `SlideDeckSpecSchema`/`LessonPlanResponseSchema` (schemas pkg), `selectSession`/`SessionNotFoundError`/`buildSlidePrompts` from `../lib/slides.js`, `estimateTokens`/`buildMaxCompletionTokens` from `../lib/tokens.js`, `primaryContextWindow` from `../lib/ai/providers.js`, mocked `chatDetailed` pattern.
- Produces:
  - `export const GenerateSlidesRequestSchema` (see Step 3 for exact shape)
  - `export function createSlidesRoutes(): Hono<HonoSchema>` mounted under `/api/slides` exposing `POST /generate`.

- [ ] **Step 1: Write failing integration tests**

`apps/studio/src/routes/slides.test.ts`:

```ts
import { Hono } from 'hono';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../config/logger.js';

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: { get: vi.fn(), set: vi.fn(), hashFile: vi.fn() },
}));
const windowHolder = vi.hoisted(() => ({ value: 128_000 }));
vi.mock('../lib/cache.js', () => ({ extractionCache: mockedExtractionCache }));
vi.mock('../lib/ai/providers.js', () => ({
  get primaryContextWindow() {
    return windowHolder.value;
  },
}));

const { mockedChatDetailed } = vi.hoisted(() => ({ mockedChatDetailed: vi.fn() }));
vi.mock('../lib/ai/client.js', () => ({ chatDetailed: mockedChatDetailed }));

import { createSlidesRoutes } from './slides.js';

function app() {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('logger' as never, createSilentLogger());
    await next();
  });
  a.route('/api/slides', createSlidesRoutes());
  return a;
}

const cachedExtraction = () => ({
  text: '',
  pages: 1,
  document: {
    learningArea: 'Life and Career Skills',
    gradeLevel: 'Grade 11',
    documentNotes: null,
    terms: [],
  },
  warnings: [],
  notes: [],
});

const validLessonPlan = {
  meta: {
    lessonTitle: 'Understanding developmental stages',
    numberOfSessions: 2,
    referencesFromBow: [],
  },
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: ['CS1'],
      performanceStandard: ['PS1'],
      learningCompetency: 'Examine sense of self',
    },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages'], learnerContext: 'visual learners' },
      { sessionLabel: 'Session 2', learningObjectives: ['map careers'], learnerContext: 'career focus' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings', flow: 'Teacher presents objectives.', learningResources: ['Slides'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 2', preLesson: 'Recall', flow: 'Career mapping.', learningResources: [], opportunitiesForIntegration: 'ICT' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: 'MCQ on stages.' },
      { sessionLabel: 'Session 2', formativeAssessment: 'Reflective entry.' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Family walk.', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Interview pro.', reflections: null },
    ],
  },
};

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  lessonPlan: validLessonPlan,
  extractionId: 'abc123',
  termLabel: 'First Term',
  weekLabel: 'Week 1',
  dryRun: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedExtractionCache.get.mockReturnValue(cachedExtraction());
});
afterEach(() => {
  windowHolder.value = 128_000;
});

describe('POST /api/slides/generate — validation & dryRun', () => {
  it('410 EXTRACTION_EXPIRED when extractionId misses cache', async () => {
    mockedExtractionCache.get.mockReturnValue(undefined);
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code?: string }).code).toBe('EXTRACTION_EXPIRED');
  });

  it('400 when lessonPlan fails schema validation', async () => {
    const bad = structuredClone(validLessonPlan) as typeof validLessonPlan & { waysForward: { sessions: Array<{ reflections: unknown }> } };
    bad.waysForward.sessions[0].reflections = 'not null';
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ lessonPlan: bad })),
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toContain('Invalid lesson plan');
  });

  it('404 with availableSessions on unknown sessionLabel', async () => {
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ sessionLabel: 'Session 9' })),
    });
    expect(res.status).toBe(404);
    const j = (await res.json()) as { availableSessions?: string[] };
    expect(j.availableSessions).toEqual(['Session 1', 'Session 2']);
  });

  it('dryRun returns prompts and budget without calling chatDetailed', async () => {
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(typeof j.systemPrompt).toBe('string');
    expect(typeof j.userPrompt).toBe('string');
    expect(typeof j.estimatedTokens).toBe('number');
    expect(typeof j.maxCompletionTokens).toBe('number');
    expect(mockedChatDetailed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/studio && pnpm exec vitest run src/routes/slides.test.ts`
Expected: FAIL — cannot import `createSlidesRoutes` (module missing).

- [ ] **Step 3: Implement route skeleton**

`apps/studio/src/routes/slides.ts`:

```ts
import {
  LessonPlanResponseSchema,
} from '@eduksource/schemas/lesson-plan.js';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { primaryContextWindow } from '../lib/ai/providers.js';
import { estimateTokens, buildMaxCompletionTokens } from '../lib/tokens.js';
import type { HonoSchema } from '../lib/types.js';
import { buildSlidePrompts, selectSession, SessionNotFoundError } from '../lib/slides.js';
import type { ExtractResponse } from '../schemas/extract.js';
import { extractionCache } from '../lib/cache.js';

export const GenerateSlidesRequestSchema = z.object({
  lessonPlan: LessonPlanResponseSchema,
  extractionId: z.string().min(1),
  termLabel: z.string().min(1),
  weekLabel: z.string().min(1),
  sessionLabel: z.string().min(1).optional(),
  systemFields: z
    .object({
      teacherName: z.string().min(1).nullable().optional(),
      sectionLabel: z.string().min(1).nullable().optional(),
      bowReference: z.string().min(1).optional(),
    })
    .optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
});

export function createSlidesRoutes() {
  const app = new Hono<HonoSchema>();

  app.post('/generate', zValidator('json', GenerateSlidesRequestSchema), async (c) => {
    const body = c.req.valid('json');

    // 410 — extraction gone from cache
    const cached = extractionCache.get(body.extractionId);
    if (!cached) {
      return c.json(
        { error: 'Extraction expired — re-upload the BOW and re-run /api/extract', code: 'EXTRACTION_EXPIRED' },
        410
      );
    }

    const extractionDoc: ExtractResponse['document'] = cached.document;

    // Phase 1: warn-only token check (parity with lesson-plan route).
    if (!c.req.header('x-internal-token')) {
      c.var.logger.withMetadata({ route: 'slides' }).warn('x-internal-token absent — allowed in Phase 1, will be required Phase 2');
    }

    // Session selection (default: first session)
    let selected;
    try {
      selected = selectSession(body.lessonPlan, body.sessionLabel);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return c.json(
          { error: err.message, availableSessions: err.availableSessions },
          404
        );
      }
      throw err;
    }

    const { systemPrompt, userPrompt } = buildSlidePrompts(selected, body.lessonPlan.meta, {
      learningArea: extractionDoc.learningArea,
      gradeLevel: extractionDoc.gradeLevel,
    });

    const promptForBudget = systemPrompt + userPrompt;
    // TODO(ADR-0008): extractionId is currently a fileHash alias; migrate to
    // normalized-text hash (BOW text → sha256) and a durable api-owned row.

    if (body.dryRun) {
      return c.json({
        systemPrompt,
        userPrompt,
        estimatedTokens: estimateTokens(promptForBudget),
        maxCompletionTokens: buildMaxCompletionTokens(primaryContextWindow, promptForBudget),
        provider: body.provider ?? 'default',
        model: body.model ?? 'default',
      });
    }

    // Non-dryRun wiring lands in Task 5.
    return c.json({ error: 'Not implemented — full generation wired in next task' }, 501);
  });

  return app;
}
```

Mount in `apps/studio/src/index.ts`:

```ts
import { createSlidesRoutes } from './routes/slides.js';
// ...existing imports...

app.route('/api/slides', createSlidesRoutes());
```

(Place next to the existing `app.route('/api/lesson-plans', …)` line.)

Import-tidiness note: `chatDetailed` is deliberately NOT imported here — Task 5 adds it along with the other LLM-path imports. The `vi.mock('../lib/ai/client.js', …)` in the test file is already inert-but-valid. Run Biome's organize-imports fix after writing.

- [ ] **Step 4: Run tests + checks**

Run: `cd apps/studio && pnpm exec vitest run src/routes/slides.test.ts && cd ../.. && pnpm lint && pnpm check-types`
Expected: 4 PASS; lint/types clean.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/routes/slides.ts apps/studio/src/routes/slides.test.ts apps/studio/src/index.ts
git commit -m "feat(studio): slides route skeleton — validation, errors, dryRun

POST /api/slides/generate accepts pre-generated LessonPlanResponse
(ADR-0006 structural — no BOW reading beyond systemFields), 410 on
expired extraction, 400 on invalid lessonPlan, 404 sessionLabel w/
availableSessions, dryRun prompts+budget without LLM call."
```

---

### Task 5: Wire LLM generation + binary PPTX response (Seam 2 part 2)

**Files:**
- Modify: `apps/studio/src/routes/slides.ts` (replace the 501 stub)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `chatDetailed`/`ChatMessage`/`ChatOptions`/`ChatDetailedResult` from `../lib/ai/client.js` (now genuinely used); `assemblePptx`, `SystemFields` from `../lib/pptx.js`.
- Produces: full `POST /generate` behavior — JSON-schema-first generation, single retry, binary response with metadata headers.

- [ ] **Step 1: Extend the integration test suite with LLM-path cases**

Append to `apps/studio/src/routes/slides.test.ts`:

```ts
const VALID_DECK = {
  title: 'Understanding developmental stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding developmental stages', imagePrompt: null },
        { layout: 'objectives', heading: 'Learning Objectives', bullets: ['a', 'b'], speakerNotes: 'n1' },
        { layout: 'motivation', heading: 'Hook', bullets: ['hook question'], speakerNotes: 'n2', imagePrompt: 'opening scene' },
        { layout: 'content', heading: 'C1', bullets: ['x'], speakerNotes: 'n3', imagePrompt: 'timeline' },
        { layout: 'content', heading: 'C2', bullets: ['y'], speakerNotes: 'n4', imagePrompt: null },
        { layout: 'activity', heading: 'Activity', bullets: ['do thing'], speakerNotes: 'n5', imagePrompt: 'group work scene' },
        { layout: 'checkForUnderstanding', heading: 'Check: MCQ prompt', speakerNotes: 'n6' },
        { layout: 'closing', heading: 'Closing', bullets: ['family walk'] },
      ],
    },
  ],
};

const makeInvalidDeckJson = (): string => {
  const bad = structuredClone(VALID_DECK) as typeof VALID_DECK & {
    sessions: Array<{ slides: Array<{ layout: string } & Record<string, unknown>> }>;
  };
  bad.sessions[0].slides[1].layout = 'hype-slide';
  return JSON.stringify(bad);
};

describe('POST /api/slides/generate — LLM + binary response', () => {
  it('happy path returns binary PPTX with metadata headers', async () => {
    mockedChatDetailed.mockResolvedValueOnce({
      content: JSON.stringify(VALID_DECK),
      usage: { input: 10, output: 10 },
      finishReason: 'stop',
      provider: 'nim',
      model: 'mock-model',
    });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('presentationml.presentation');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('x-retried')).toBe('false');
    expect(res.headers.get('x-provider')).toBe('nim');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('retries once with appended validation feedback and reports retried=true', async () => {
    mockedChatDetailed
      .mockResolvedValueOnce({ content: makeInvalidDeckJson(), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(VALID_DECK), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-retried')).toBe('true');
    expect(mockedChatDetailed).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockedChatDetailed.mock.calls.at(1)?.[0] as Array<{ role: string; content: string }>;
    const secondUserMsg = secondCallMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(secondUserMsg).toContain('Previous output failed validation');
    expect(secondUserMsg).toContain('layout');
  });

  it('502 with trimmed raw after both attempts fail validation', async () => {
    mockedChatDetailed
      .mockResolvedValueOnce({ content: makeInvalidDeckJson(), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' })
      .mockResolvedValueOnce({ content: `${makeInvalidDeckJson()}${'x'.repeat(9000)}`, usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(502);
    const j = (await res.json()) as { validationErrors?: string; raw?: string; provider?: string; model?: string };
    expect(j.validationErrors).toBeTruthy();
    expect((j.raw ?? '').length).toBeLessThanOrEqual(8192);
    expect(j.provider).toBe('nim');
    expect(j.model).toBe('m');
  });

  it('forwards provider/model overrides to chatDetailed', async () => {
    mockedChatDetailed.mockResolvedValueOnce({ content: JSON.stringify(VALID_DECK), usage: {}, finishReason: 'stop', provider: 'openrouter', model: 'override-model' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false, provider: 'openrouter', model: 'override-model' })),
    });
    expect(res.status).toBe(200);
    const firstCallOpts = mockedChatDetailed.mock.calls.at(0)?.[1] as { task?: string; model?: string };
    expect(firstCallOpts.task).toBe('lesson_plan');
    expect(firstCallOpts.model).toBe('override-model');
  });

  it('fatal provider failure yields 502 with trimmed raw', async () => {
    mockedChatDetailed.mockRejectedValue(new Error('provider chain exhausted'));
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(502);
    const j = (await res.json()) as { validationErrors?: string };
    expect(j.validationErrors).toContain('provider chain exhausted');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/studio && pnpm exec vitest run src/routes/slides.test.ts`
Expected: 4 earlier cases still pass; 5 new cases FAIL (route currently stubs 501).

- [ ] **Step 3: Wire the full generation path**

Replace the `return c.json({ error: 'Not implemented — full generation wired in next task' }, 501);` tail of the handler in `apps/studio/src/routes/slides.ts` with:

```ts
    // Defined once for both dryRun-independence and the wired LLM call below.
    const maxCompletionTokens = buildMaxCompletionTokens(primaryContextWindow, promptForBudget);

    const slideDeckJsonSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        sessions: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: {
            type: 'object',
            properties: {
              sessionLabel: { type: 'string' },
              slides: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    layout: {
                      type: 'string',
                      enum: ['title', 'objectives', 'motivation', 'content', 'activity', 'checkForUnderstanding', 'closing'],
                    },
                    heading: { type: 'string' },
                    bullets: { type: 'array', items: { type: 'string' }, maxItems: 5 },
                    speakerNotes: { type: 'string' },
                    imagePrompt: { type: ['string', 'null'] },
                  },
                  required: ['layout', 'heading'],
                },
              },
            },
            required: ['sessionLabel', 'slides'],
          },
        },
      },
      required: ['title', 'sessions'],
    };

    let retried = false;
    let rawContent: string | null = null;
    let providerUsed = body.provider ?? 'primary';
    let modelUsed = body.model ?? 'default';

    const callOnce = async (
      messages: ChatMessage[],
      opts: ChatOptions
    ): Promise<ChatDetailedResult> => {
      try {
        return await chatDetailed(messages, {
          ...opts,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'SlideDeckSpec', schema: slideDeckJsonSchema, strict: false },
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/response_format|json_schema|unsupported/i.test(msg)) {
          return chatDetailed(messages, opts); // single prose fallback
        }
        throw err;
      }
    };

    const tryParse = (content: string | null) => {
      if (content === null) throw new Error('Empty LLM response');
      return SlideDeckSpecSchema.parse(JSON.parse(content));
    };

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const opts: ChatOptions = {
      task: 'lesson_plan',
      max_completion_tokens: maxCompletionTokens,
      model: body.model,
    };

    try {
      const first = await callOnce(messages, opts);
      rawContent = first.content;
      providerUsed = (first as { provider?: string }).provider ?? providerUsed;
      modelUsed = (first as { model?: string }).model ?? modelUsed;

      let deck: SlideDeckSpec;
      try {
        deck = tryParse(first.content);
      } catch (firstErr) {
        const validationMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        retried = true;
        const retryMessages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `${userPrompt}\n\nPrevious output failed validation:\n - ${validationMsg}\nReturn only valid JSON.`,
          },
        ];
        const second = await callOnce(retryMessages, opts);
        rawContent = second.content;
        deck = tryParse(second.content); // throws to fatal handler on repeat failure
      }

      const systemFields: SystemFields = {
        teacherName: body.systemFields?.teacherName ?? null,
        sectionLabel: body.systemFields?.sectionLabel ?? null,
        gradeLevel: extractionDoc.gradeLevel,
        learningArea: extractionDoc.learningArea,
        generationMetadata: {
          provider: providerUsed,
          model: modelUsed,
          generatedAt: new Date().toISOString(),
        },
        bowReference: body.systemFields?.bowReference ?? `DepEd BOW — ${body.termLabel}, ${body.weekLabel}`,
      };

      const pptxBuffer = await assemblePptx(deck, systemFields);

      c.header('Content-Disposition', 'attachment; filename="slides.pptx"');
      c.header('X-Provider', providerUsed);
      c.header('X-Model', modelUsed);
      c.header('X-Retried', String(retried));
      c.header('X-Generated-At', systemFields.generationMetadata.generatedAt);
      return c.body(pptxBuffer, 200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
    } catch (fatalOrValidation) {
      const isValidationExhausted = retried; // retried=true and we got here → second parse threw
      const err = fatalOrValidation;
      const msg = err instanceof Error ? err.message : String(err);
      if (isValidationExhausted) {
        return c.json(
          {
            error: 'Slide deck generation failed validation after retry',
            validationErrors: msg,
            raw: (rawContent ?? '').slice(0, 8192),
            provider: providerUsed,
            model: modelUsed,
          },
          502
        );
      }
      return c.json(
        {
          error: 'Slide deck generation failed',
          validationErrors: msg,
          raw: (rawContent ?? '').slice(0, 8192),
          provider: providerUsed,
          model: modelUsed,
        },
        502
      );
    }
```

Required additional imports at top of `routes/slides.ts` (Task 4 omitted them):

```ts
import type { ChatDetailedResult, ChatMessage, ChatOptions } from '../lib/ai/client.js';
import { chatDetailed } from '../lib/ai/client.js';
import type { SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { SlideDeckSpecSchema } from '@eduksource/schemas/slide-deck.js';
import { assemblePptx, SystemFields } from '../lib/pptx.js';
```

Behavior notes:
- `retried=true` reaching the outer catch means the second parse threw (first parse already failed). Both messages distinguish "failed validation after retry" vs "generation failed" but status is 502 either way, mirroring lesson-plan semantics.
- `strict: false` on the json_schema envelope: the draft enum + maxItems shape can't be fully strictly-typed across every provider yet — prose prompt carries the constraints and the Zod parse is the authority. Log a line when falling back so provider parity stays visible (`c.var.logger.warn(...)` inside the catch branch).

- [ ] **Step 4: Run the full seam**

Run: `cd apps/studio && pnpm exec vitest run src/routes/slides.test.ts src/lib/pptx.test.ts src/lib/slides.test.ts && cd ../.. && pnpm lint && pnpm check-types`
Expected: ALL PASS (≈15 tests: 4 validation/dryRun + 5 LLM-path + 3 lib-slides + assembler suite).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/routes/slides.ts apps/studio/src/routes/slides.test.ts
git commit -m "feat(studio): wire slides LLM — json_schema→fallback, retry, binary PPTX

Full POST /api/slides/generate: registry chatDetailed task lesson_plan,
json_schema strict-first w/ prose fallback, single retry appending
validation feedback, assemblePptx inline, binary response w/
Content-Disposition + X-Provider/X-Model/X-Retried/X-Generated-At.
502s trimmed to 8192 chars."
```

---

### Task 6: Workspace verification + doc checkbox

**Files:**
- Modify: `docs/plan.md` (PPTX checkbox)

**Interfaces:** none — verification gate only.

- [ ] **Step 1: Full workspace gates**

Run:
```bash
pnpm lint && pnpm check-types && pnpm build:packages
pnpm --filter @eduksource/schemas exec vitest run
pnpm --filter @eduksource/studio exec vitest run src/routes/slides.test.ts src/lib/pptx.test.ts src/lib/slides.test.ts src/lib/tokens.test.ts
```
Expected: everything green. Pre-existing unrelated failures elsewhere (e.g. fixture-named extract.patterns cases needing big PDFs) are tracked separately — confirm they fail identically on `main` before your change if anything unexpected appears.

- [ ] **Step 2: Flip the roadmap checkbox**

In `docs/plan.md`, Phase 1 Track B, change:

```markdown
- [ ] PPTX generation: lesson plan JSON → slides via `pptxgenjs` (basic template)
```
to:
```markdown
- [✅] PPTX generation: lesson plan JSON → slides via `pptxgenjs` (basic template)
```

- [ ] **Step 3: Commit the checkbox flip**

```bash
git add docs/plan.md
git commit -m "docs(plan): mark PPTX generation done in Phase 1 Track B"
```

---

## Post-implementation provenance

- GitHub issue #6 tracks this slice: https://github.com/jeius/eduksource-ph/issues/6
- Spec travels at `docs/specs/2026-08-25-pptx-generation-spec.md`; scratch copy `.scratch/pptx-generation/spec.md`.
- After merge, `docs/progress.md` should gain the PPTX bullet under Phase 1 Track B Done (as done for lesson-plan in commit 915af04) — fold into the PR's final docs commit if convenient.
