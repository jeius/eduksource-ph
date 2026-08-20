# Studio — Lesson Plan Generation Spec

**Status:** Accepted
**Depends on:** BOW extraction endpoint (`ExtractResponse`), ADR-0002 (swappable AI provider registry), `docs/specs/2026-08-17-bow-extraction-caching-design.md` (`extractionId` mechanics).
**Feeds into:** `docs/specs/2026-08-17-lesson-output-assembly-design.md` — this endpoint's output (`LessonPlanResponse`) is the DOCX-facing generation, and is also the input to `SlideDeckSpec` generation (per that spec's §5.1, formalized as ADR-0006).

---

## 1. Scope

This covers the second route in the Phase 1 checklist: turning a scoped slice of an already-extracted BOW (one term, one week) into a structured lesson plan matching the DepEd template's fields. It does not cover PPTX/DOCX assembly (separate spec) or the summative/term exam route (not yet specced).

---

## 2. Prerequisite: extraction needs to be cacheable by ID

The `ExtractResponse` schema as it exists today has no `extractionId` — it's returned directly from `/extract`. This endpoint's whole cost/speed design (§3) depends on **not** re-sending the full BOW extraction on every generation call.

**See `docs/specs/2026-08-17-bow-extraction-caching-design.md` for the full design** — in short, `extractionId` is a normalized-text content hash of the extracted BOW (ADR-0007, refined by ADR-0008), backed by a two-tier cache (in-memory for the active session, a durable `api`-owned record for reuse across sessions, since a given BOW is reused week after week rather than uploaded once and discarded). This endpoint only needs to know that a valid `extractionId` resolves to a cached `ExtractResponse` — it doesn't need to know how that cache is implemented underneath.

---

## 3. Endpoint contract

```ts
// POST /lesson-plans/generate
type GenerateLessonPlanRequest = {
  extractionId: string;
  termLabel: string;
  weekLabel: string;
  sessionsOverride?: number;     // defaults to the block's durationDays
  provider?: string;             // overrides AI_PROVIDER for this call — see §6
  model?: string;                // overrides AI_MODEL_LESSON_PLAN for this call
  dryRun?: boolean;              // returns the constructed prompt, skips the LLM call
};

type GenerateLessonPlanResponse = {
  lessonPlan: LessonPlanResponse;   // see §5
  generationMetadata: {
    provider: string;
    model: string;
    generatedAt: string;            // ISO timestamp
    retried: boolean;               // true if the structured-output retry (§7) fired
  };
};
```

Notably **absent** from the request: `teacherName`, `sectionLabel`. Those don't belong here — they're resolved later, in the `SystemFields` object at assembly time (see `2026-08-17-lesson-output-assembly-design.md` §3). This endpoint's only job is producing curriculum content; who's teaching it and which section is scheduling/admin information layered on afterward, not something this route should know or care about.

---

## 4. Context scoping

```ts
function buildLessonPlanContext(extraction: ExtractResponse, termLabel: string, weekLabel: string) {
  const term = extraction.document.terms.find(t => t.termLabel === termLabel);
  if (!term) throw new NotFoundError(`Term "${termLabel}" not found`);

  const block = term.blocks.find(b => b.weekLabel === weekLabel);
  if (!block) throw new NotFoundError(`Week "${weekLabel}" not found in ${termLabel}`);

  // block-level values override term-level ones when present — mirrors the
  // nullability already built into ExtractResponse's schema
  return {
    learningArea: extraction.document.learningArea,
    gradeLevel: extraction.document.gradeLevel,
    contentStandard: block.contentStandard ?? term.contentStandard ?? [],
    performanceStandard: block.performanceStandard ?? term.performanceStandard ?? [],
    skillsFocus: block.skillsFocus ?? term.skillsFocus ?? null,
    strands: block.strands,
    suggestedActivities: term.suggestedActivities ?? [],
    suggestedPerformanceTasks: term.suggestedPerformanceTasks ?? [],
    durationDays: block.durationDays ?? 1,
    extractionNotes: block.extractionNotes,
  };
}
```

This filtered object — not the raw `ExtractResponse` — is what goes into the prompt. For a single week this is a fraction of the token count of the full BOW; that's most of the cost/speed win, independent of which model handles the call.

**Error cases:**

- `extractionId` not found or expired → `410 Gone` (the client should re-run `/extract`, not retry blindly)
- `termLabel`/`weekLabel` not found in the cached extraction → `404 Not Found`, with the available labels listed in the error body so the admin UI can show a useful message instead of a raw 404

---

## 5. Output schema

```ts
type LessonPlanResponse = {
  meta: {
    lessonTitle: string;
    numberOfSessions: number;
    referencesFromBow: string[];   // AI-suggested additions; the BOW citation itself is system-appended, not generated
  };
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: string[];
      performanceStandard: string[];
      learningCompetency: string;
    };
    sessions: {
      sessionLabel: string;        // "Session 1" .. "Session N" — generic, not scheduled dates/times, see §8
      learningObjectives: string[];
      learnerContext: string;
    }[];
  };
  learningExperience: {
    sessions: {
      sessionLabel: string;
      preLesson: string;
      flow: string;                 // written FOR THE TEACHER — see 2026-08-17-lesson-output-assembly-design.md §5.1 (ADR-0006) for why this never goes straight onto a slide
      learningResources: string[];
      opportunitiesForIntegration: string;   // genuine cross-subject link, or literally "N/A" — never padded to seem more complete than it is
    }[];
  };
  assessment: {
    sessions: {
      sessionLabel: string;
      formativeAssessment: string;
    }[];
  };
  waysForward: {
    sessions: {
      sessionLabel: string;
      extendedLearningOpportunities: string;   // fine for the model to suggest
      reflections: null;                        // ALWAYS null — see §8, never populated by generation
    }[];
  };
};
```

`numberOfSessions` defaults to the context's `durationDays`, overridable via `sessionsOverride` in the request — this is the configurability the endpoint was built for, resolved one level below term/week.

---

## 6. Prompt design

**System prompt** encodes the template's actual pedagogical rules — lifted close to verbatim from `LP_Template_for_Orientations.pdf`, since that document already states the rules well:

> Write for a teacher, not a database. Apply the Learning Design Principles to every session's Flow: make objectives clear before the task, guide learners before independent work, check well-being/understanding/mastery mid-session, connect to past competencies, encourage collaboration, invite personal reflection on relevance, and ensure inclusion for varied abilities/learning styles/contexts. `opportunitiesForIntegration` must be a genuine cross-subject link or literally `"N/A"`. Never populate `reflections` — see below. Do not invent `teacherName`, `sectionLabel`, dates, or scheduling information; none of that is available to you and none of it belongs in this output.

That last sentence matters more than it looks — it's a direct instruction not to hallucinate the fields that were deliberately excluded from the schema in §5. Belt-and-suspenders: the schema already can't hold those fields, but a model that's seen enough real DLL documents (like the sample used to build this spec) may still try to work a teacher name or class schedule into free-text fields like `flow` or `learnerContext` unless explicitly told not to.

**User message** = the filtered context object from §4, plus `sessionsOverride` if provided.

---

## 7. Structured output & validation

- Use the provider's JSON schema / structured-output mode (`response_format: json_schema` on the OpenAI-compatible providers — NIM and OpenRouter both support this) rather than asking for JSON in prose. This is the single highest-leverage spec from the earlier model comparison — structured-output reliability matters more here than raw benchmark rank, because a malformed response breaks the DOCX/PPTX assembly steps downstream, not just this response.
- Validate the response against a Zod schema in `packages/schemas` (the same schema consumed by the assembly spec) before returning it.
- **On validation failure: retry once**, with the validation errors appended to the prompt so the model can see what it got wrong, before failing the request outright. Set `generationMetadata.retried = true` if this fires — useful signal for later prompt tuning (a model that retries often on a particular provider is a candidate to drop from rotation).
- If the retry also fails validation, return `502 Bad Gateway` with the raw model output attached for debugging, rather than silently returning malformed data.

---

## 8. Explicitly out of scope for this endpoint

| Not handled here | Where it actually belongs |
| --- | --- |
| `teacherName`, `sectionLabel` | `SystemFields`, resolved at assembly time (`2026-08-17-lesson-output-assembly-design.md` §3) |
| Real class schedule (dates, periods) — note the DLL sample bakes actual timetable data into "Intentions" | Admin/scheduling concern; `sessionLabel` here stays generic (`"Session 1"`) |
| `reflections` | Always `null` — filled by the teacher after the lesson is taught, never generated |
| Prepared by / Checked by / Noted signature block | Admin review step, resolved at assembly time |
| Declaration of AI use wording | System-templated at assembly time from `generationMetadata`, not free-written by the model |
| Slide content | Separate generation, chained off this endpoint's output — see `2026-08-17-lesson-output-assembly-design.md` §5.1 / ADR-0006 |

The theme across this table: this endpoint's job is curriculum content only. Anything that's scheduling, admin workflow, or post-lesson teacher input stays out of its schema entirely rather than being included and instructed-not-to-fill — matching the reasoning from the placeholder discussion (keep system-known and human-only fields out of the AI schema, don't rely on the model to leave them alone).

---

## 9. `dryRun` as an evaluation harness

`dryRun: true` returns the fully constructed system + user prompt without calling the model. Combined with the `provider`/`model` overrides in §3, this endpoint doubles as the A/B harness for comparing candidate models on real BOW content — construct the same prompt, send it to two providers manually, judge the output against your own rubric. Worth keeping this parameter even after the pipeline is otherwise stable; it's cheap to keep and useful whenever a new model is worth evaluating.

---

## 10. Open items

- Confirm the JSON-schema/structured-output feature is actually available and behaves consistently across every provider in the registry (ADR-0002) — NIM, OpenRouter, and Opencode Go (confirmed OpenAI-compatible 2026-08-16, per `docs/architecture.md` §3) should all support this, but verify per-provider before assuming parity.
- Decide the caching store for `extractionId` (in-memory is fine for a single-instance Phase 1 deploy; revisit if Studio ever runs multiple instances, since in-memory cache wouldn't be shared across them).
- `referencesFromBow` — decide whether AI-suggested references need any validation (e.g. checking a suggested URL actually resolves) before being shown to the editor, or whether that's acceptable to leave as an editor-review concern.
