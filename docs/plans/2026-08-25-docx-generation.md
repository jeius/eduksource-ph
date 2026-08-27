# DOCX Generation Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/docx/generate` to `apps/studio` — assemble a formal DepEd-style DLL Word document (A4, 7-row header table, N-session main body table, signature block, rubric page) from a reviewed `LessonPlanResponse` via the `docx` npm package, with zero AI calls.

**Architecture:** Promote `SystemFields` to a shared Zod schema in `packages/schemas` (extended with signature + letterhead fields), refactor the existing PPTX assembler to consume it, then add a pure `assembleDocx()` function in `apps/studio/src/lib/` and a thin Hono route that validates input → assembles inline → returns binary. Unlike the slides route there is no LLM layer, no dryRun, and no session selection: the DLL renders all N sessions as columns, and determinism means the editor reviews the actual file.

**Tech Stack:** TypeScript strict, Zod v4, Hono + `@hono/zod-validator`, `docx` npm `^9.7.1` (new dep), existing extraction-cache + token helpers untouched.

**Spec:** `docs/specs/2026-08-25-docx-generation-spec.md` (GitHub issue #8). Reference: `docs/specs/2026-08-17-lesson-output-assembly-design.md` §4 (DOCX assembly, binding implementation rules §4.5); banner intro texts verbatim from `apps/studio/tests/fixtures/LP_Template_for_Orientations.pdf` P2-P5 (reproduced in Tasks below); signature-block reality from `ValEd_DLL_Week_1.pdf` P16.

## Global Constraints

- Zero AI calls anywhere in this slice — pure assembly (assembly spec §6 step 4). No `chatDetailed`, no provider registry changes, no dryRun.
- Node runtime (ADR-0001); registry/no-db/no-direct-OpenAI constraints unchanged (ADR-0002/0003).
- A4 page size (assembly spec §7, resolved).
- `columnWidths` on both tables AND `width` on every cell, `WidthType.DXA` — never percentage (breaks Google Docs). Widths must sum to the table width; `sessionColWidth = (tableWidth - labelColWidth) / N`.
- Banner shading `ShadingType.CLEAR` with fill `D9D9D9` — never `SOLID` (renders black).
- Every line is its own `Paragraph` — never `\n` inside text.
- `PageBreak` inside a `Paragraph`, never standalone.
- Reflections row: **always** `TEACHER_FILL_NOTE`, never model-sourced (spec §2).
- Declaration of AI use: system-templated string parameterized with generationMetadata — never model free-written (spec §4.2). Exact template: `AI tools ({model} via {provider}) were used to assist in organizing lesson components and formatting this lesson plan based on curriculum standards, following DO 3 s.2026 Annex A. All content was reviewed, contextualized, and validated by the facilitator prior to use.`
- References cell: numbered paragraphs, `1.` = system bowReference first, then AI-suggested `referencesFromBow` (Q4).
- Learning Competency row: one merged cell spanning all N session columns (`columnSpan: N`) (Q5).
- Errors: `410 {code:'EXTRACTION_EXPIRED'}` on cache miss; `400` on invalid lessonPlan. Only these two (Q1).
- Success response: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="lesson-plan.docx"`, `X-Generated-At` ISO header (Q1).
- `x-internal-token` missing = warn-only; `TODO(ADR-0008)` comment carried (same as prior slices).
- TS strict (noUncheckedIndexedAccess — guards not `!`), Biome clean, Conventional Commits, TDD per task.

---

## File Structure

```txt
packages/schemas/src/
  system-fields.ts           # NEW   SystemFieldsSchema (extended) + inferred type
  system-fields.test.ts      # NEW   schema unit tests
  index.ts                   # MODIFY  re-export
packages/schemas/package.json  # MODIFY  ./system-fields[.js] subpath exports

apps/studio/src/lib/
  docx.ts                    # NEW   assembleDocx + buildRubricPage + banner intros
  docx.test.ts               # NEW   Seam 1 — assembler unit tests
  pptx.ts                    # MODIFY  import shared SystemFields (delete local type)

apps/studio/src/routes/
  docx.ts                    # NEW   POST /generate handler (validate → assemble → binary)
  docx.test.ts               # NEW   Seam 2 — HTTP integration tests

apps/studio/src/index.ts     # MODIFY  mount createDocxRoutes()
apps/studio/package.json     # MODIFY  add docx dependency
```

Task split for subagent ownership: Task 1 = schemas promotion + pptx refactor (one commit, keeps the shared type from day one); Task 2 = assembler (owns `lib/docx.*` + dep install); Task 3 = route + mount + verification gates.

---

### Task 1: Shared SystemFields schema + PPTX refactor

**Files:**
- Create: `packages/schemas/src/system-fields.ts`
- Test: `packages/schemas/src/system-fields.test.ts`
- Modify: `packages/schemas/src/index.ts`, `packages/schemas/package.json`, `apps/studio/src/lib/pptx.ts`

**Interfaces:**
- Produces: `export const SystemFieldsSchema = z.object({ teacherName: z.string().min(1).nullable(), sectionLabel: z.string().min(1).nullable(), gradeLevel: z.string().min(1), learningArea: z.string().min(1), generationMetadata: z.object({ provider: z.string().min(1), model: z.string().min(1), generatedAt: z.string().min(1) }), bowReference: z.string().min(1), preparedBy: z.string().min(1).nullable().optional(), checkedBy: z.string().min(1).nullable().optional(), notedBy: z.string().min(1).nullable().optional(), checkedByRole: z.string().min(1).optional(), notedByRole: z.string().min(1).optional(), letterhead: z.object({ lines: z.array(z.string().min(1)).min(1) }).nullable().optional() })` and `export type SystemFields = z.infer<typeof SystemFieldsSchema>`.
- Subpath exports `./system-fields` and `./system-fields.js` mirroring `./slide-deck`.
- `apps/studio/src/lib/pptx.ts`: delete the local `export type SystemFields = {...}` block and instead `import type { SystemFields } from '@eduksource/schemas/system-fields.js';` — no other pptx change (all new fields optional; existing call sites/tests keep compiling because the old local type's fields are a subset).

- [ ] **Step 1: Write failing tests** — `packages/schemas/src/system-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SystemFieldsSchema } from './system-fields.js';

const full = {
  teacherName: 'Maiza R. Evangelista',
  sectionLabel: '11-Tesla',
  gradeLevel: 'Grade 11',
  learningArea: 'Life and Career Skills',
  generationMetadata: { provider: 'nim', model: 'test-model', generatedAt: '2026-08-27T00:00:00Z' },
  bowReference: 'DepEd BOW — First Term, Week 1',
  preparedBy: 'Maiza R. Evangelista',
  checkedBy: 'Janice P. Enriquez',
  notedBy: 'Hazel Y. Manalo PhD',
  checkedByRole: 'Head Teacher III',
  notedByRole: 'Principal IV',
  letterhead: { lines: ['Republic of the Philippines', 'Department of Education'] },
};

describe('SystemFieldsSchema', () => {
  it('accepts the full shape including signature + letterhead fields', () => {
    expect(() => SystemFieldsSchema.parse(full)).not.toThrow();
  });

  it('accepts the minimal PPTX-era shape (signatures/letterhead omitted)', () => {
    const { preparedBy, checkedBy, notedBy, checkedByRole, notedByRole, letterhead, ...minimal } = full;
    void preparedBy; void checkedBy; void notedBy; void checkedByRole; void notedByRole; void letterhead;
    expect(() => SystemFieldsSchema.parse(minimal)).not.toThrow();
  });

  it('accepts null teacherName/sectionLabel (fill-blank path)', () => {
    expect(() => SystemFieldsSchema.parse({ ...full, teacherName: null, sectionLabel: null })).not.toThrow();
  });

  it('requires gradeLevel, learningArea, bowReference and generationMetadata', () => {
    const bad = { ...full } as Record<string, unknown>;
    delete bad.gradeLevel;
    expect(SystemFieldsSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `pnpm exec vitest run packages/schemas/src/system-fields.test.ts` (from repo root; schemas has no local vitest config). Expected: FAIL module not found.
- [ ] **Step 3: Implement** — `packages/schemas/src/system-fields.ts` per the schema in Interfaces (header comment: shared assembly input contract, spec §3 + grilling Q2/Q3). Append barrel re-export; add both subpath entries to package.json exports.
- [ ] **Step 4: Refactor pptx.ts** — replace local type with the shared import; verify with `cd apps/studio && pnpm exec vitest run src/lib/pptx.test.ts` (4/4 still pass) and `pnpm check-types`.
- [ ] **Step 5: Run gates** — `pnpm exec vitest run packages/schemas/src/system-fields.test.ts packages/schemas/src/slide-deck.test.ts packages/schemas/src/studio-constants.test.ts` (10/10), `pnpm lint`, `pnpm check-types`, `pnpm build:packages`.
- [ ] **Step 6: Commit** — `feat(schemas): promote shared SystemFields + signature/letterhead fields` with body: one assembly contract for DOCX + PPTX (spec §3), preparedBy/checkedBy/notedBy + roles per DLL 3-person block, optional letterhead stub (grilling Q2/Q3); pptx assembler refactored onto the shared type.

### Task 2: DOCX assembler (`lib/docx.ts`, Seam 1)

**Files:**
- Create: `apps/studio/src/lib/docx.ts`, Test: `apps/studio/src/lib/docx.test.ts`
- Modify: `apps/studio/package.json` (add `docx` dep)

**Interfaces:**
- Consumes: `LessonPlanResponse` from `@eduksource/schemas/lesson-plan.js`; `SystemFields`, `TEACHER_FILL_BLANK`, `TEACHER_FILL_NOTE` from `@eduksource/schemas/system-fields.js` and `@eduksource/schemas/studio-constants.js`.
- Produces: `export async function assembleDocx(lp: LessonPlanResponse, fields: SystemFields): Promise<Buffer>`; `export function buildRubricPage(): (Paragraph | Table)[]`; `export const BANNER_INTROS: Record<'Intentions'|'Learning Experience'|'Assessment'|'Ways Forward', string>` (verbatim strings below); test hook `(globalThis as { __lastDocxDocument?: unknown }).__lastDocxDocument = doc;` set before returning the Buffer.

Verbatim banner intros (template P2-P4 — copy exactly):

```ts
export const BANNER_INTROS = {
  Intentions:
    'Meaningful learning experiences are anchored in how we frame them. Start by deciding what you want learners to master by the end of the lesson – keep it clear and simple. Remember: Understanding your learners’ evolving context and designing around it ensure that your lessons connect with and are relevant to them.',
  'Learning Experience':
    'A learning experience is like a thoughtfully designed journey. Each activity and interaction builds towards meaningful understanding and growth. Identify activities and interactions to help learners gain knowledge, skills, or understanding in a purposeful way.',
  Assessment:
    'Create a task, activity or questions to evaluate learning and provide feedback every now and then. Include ways for learners to ask for guidance or support throughout each session. Remember to provide appropriate accommodations so all learners can demonstrate their understanding (e.g., varied response formats, small group options, visual or auditory supports).',
  'Ways Forward':
    'Meaningful learning can also happen beyond the classroom – for both the learners and the teacher. Pause and reflect on what happened today.',
} as const;
```

Rubric rows (template P5, verbatim — 9 items): 1. Intentions are clearly stated, with appropriate learning competencies articulated. 2. Intentions are evident across all sections, there is coherence. 3. Learning experience is clear – another teacher can implement this lesson without additional explanation. 4. Learning experience is well-designed, with intentionally embedded Learning Design Principles. 5. Learning experience maximizes available opportunities for integration. 6. Learning experience is inclusive, provides opportunities to support learners with disabilities, barriers, and unique contexts. 7. Assessment strategies are integrated throughout the session to see learners' progress or if they need support. 8. Assessment strategies generate evidence if learning is successful. 9. The following interventions are actionable, providing ways to extend or adjust learning based on reflections. Plus trailing line: `Notes for my instructional coaching session:`.

- [ ] **Step 1: Install dep** — `pnpm add --filter @eduksource/studio docx@^9.7.1`
- [ ] **Step 2: Write failing tests** — `apps/studio/src/lib/docx.test.ts` with: minimal 2-session `LessonPlanResponse` fixture; `baseFields` with real names + letterhead lines. Tests: (1) non-empty Buffer with PK signature; (2) `__lastDocxDocument` exposed; (3) serialized document XML (via `Packer.toString`-equivalent — simplest: `JSON.stringify(doc)` after grabbing the hook) contains `lessonTitle`, both session labels, `TEACHER_FILL_NOTE` ×2, `TEACHER_FILL_BLANK` for a null-names run, Declaration fragment `via test-model`, all 9 rubric row snippets, letterhead line, `1.` numbered bowReference; (4) merged competency cell: XML contains `columnSpan` or the competency text exactly once. Note: docx `Document` objects serialize the content tree — assert against `JSON.stringify(doc)` strings we control, never library internals.
- [ ] **Step 3: Run to verify fail** — `cd apps/studio && pnpm exec vitest run src/lib/docx.test.ts` → FAIL module not found.
- [ ] **Step 4: Implement** — `lib/docx.ts`: `new Document({ sections: [{ properties: { page: { size: { orientation: 'landscape'?? no — A4 portrait, width 11906, height 16838 (DXA twips) } } } }] }` — build header table (7 rows × 2 cols), main body table (label col `labelColWidth = 2200` twips, sessions share the rest of `tableWidth = 11906 - 1440` margins ⇒ compute `sessionColWidth`), banner rows as single-cell full-width rows w/ `ShadingType.CLEAR`/`D9D9D9` + italic label + intro Paragraph, competency row `columnSpan: N`, per-session rows from the LP, Reflections row cells = `TEACHER_FILL_NOTE`, signature 3-col table, `new Paragraph({ children: [new PageBreak()] })`, then `...buildRubricPage()`. Letterhead: when `fields.letterhead?.lines`, emit centered small-caps-style (allCaps: true) Paragraphs first. Set `(globalThis as {__lastDocxDocument?: unknown}).__lastDocxDocument = doc;` then `return Buffer.from(await Packer.toBuffer(doc));`
- [ ] **Step 5: Run tests + gates** — assembler tests pass; `pnpm lint`; `pnpm check-types`.
- [ ] **Step 6: Commit** — `feat(studio): add docx assembler (assembleDocx)` with body: A4 DLL layout per assembly spec §4 — 7-row header w/ templated AI declaration, banner intros verbatim from template, merged competency cell, per-session rows, TEACHER_FILL_NOTE reflections, 3-person signature, static 9-row rubric page; DXA widths everywhere; docx@^9.7.1.

### Task 3: Route + mount + verification gates (Seam 2)

**Files:**
- Create: `apps/studio/src/routes/docx.ts`, Test: `apps/studio/src/routes/docx.test.ts`
- Modify: `apps/studio/src/index.ts` (mount), `docs/plan.md` (checkbox flip)

**Interfaces:**
- Consumes: `LessonPlanResponseSchema`, `SystemFieldsSchema`, `assembleDocx`, extractionCache, `extractionDoc` pattern from slides route.
- Produces: `export const GenerateDocxRequestSchema` = z.object({ lessonPlan: LessonPlanResponseSchema, extractionId min1, termLabel min1, weekLabel min1, systemFields: SystemFieldsSchema.partial() extended — i.e. `z.object({ teacherName: nullable optional, sectionLabel: nullable optional, bowReference: optional, preparedBy/checkedBy/notedBy: nullable optional, checkedByRole/notedByRole: optional, letterhead: nullable optional }).optional()`; `export function createDocxRoutes(): Hono` mounted at `/api/docx`.

Handler logic: warn-only token check → 410 on cache miss → merge systemFields: `{ teacherName: body.systemFields?.teacherName ?? null, sectionLabel: ... ?? null, gradeLevel: extractionDoc.gradeLevel, learningArea: extractionDoc.learningArea, generationMetadata: { provider: 'assembly', model: 'docx-assembly', generatedAt: new Date().toISOString() }, bowReference: body.systemFields?.bowReference ?? `DepEd BOW — ${body.termLabel}, ${body.weekLabel}`, ...rest-of-optional-fields }` → `assembleDocx(body.lessonPlan, fields)` → binary response headers. Note generationMetadata has no real provider/model here (no AI call) — use the `'assembly'` placeholder values above unless the caller passes overrides; the Declaration line then reads "AI tools (docx-assembly via assembly)…" which is wrong. **Resolution (locked by grilling Q1 rationale + spec §4.2):** the route accepts optional `generationMetadata?: { provider?, model? }` in request body; when absent the Declaration row renders the template with the last known values IF provided else the literal text `AI-assisted assembly — see DO 3 s.2026 Annex A.` Test both paths.

- [ ] **Step 1: Write failing tests** — `routes/docx.test.ts`: vi.hoisted mocks (extractionCache, providers window, silent-logger app()); tests: 410 expired; 400 invalid lessonPlan (reflections 'not null'); happy path 200 binary (content-type wordprocessingml.document, Content-Disposition attachment filename="lesson-plan.docx", X-Generated-At present, buffer PK >1000 bytes); declaration fallback path (no generationMetadata → XML contains `AI-assisted assembly — see DO 3 s.2026 Annex A.`); declaration template path (generationMetadata {provider:'nim', model:'gpt-x'} → contains `gpt-x via nim`).
- [ ] **Step 2: Verify fail** — module not found.
- [ ] **Step 3: Implement** — `routes/docx.ts` per Interfaces + resolution above; mount in `index.ts` at `/api/docx`; `TODO(ADR-0008)` comment; warn-only token log.
- [ ] **Step 4: Verify pass + full gates** — route tests 5/5; assembler 4/4; full studio suite; `pnpm lint`, `pnpm check-types`, `pnpm build:packages`.
- [ ] **Step 5: Flip checkbox** — `docs/plan.md:50` `- [ ] DOCX generation…` → `- [✅] DOCX generation: lesson plan JSON → Word doc via `docx` (npm)`.
- [ ] **Step 6: Commit** — `feat(studio): wire docx route — validate, assemble, binary response` (body: 410/400/binary happy path, declaration template vs fallback paths, mounted at /api/docx) and separate `docs(plan): mark DOCX generation done in Phase 1 Track B`.

---

## Self-review notes

- Spec coverage: header 7 rows (Task 2), banner intros verbatim (Task 2), merged competency (Task 2), reflections note (Task 2), signature block w/ roles (Tasks 1+2), rubric page (Task 2), letterhead stub (Tasks 1+2), numbered references (Task 2), shared SystemFields promotion (Task 1), route errors + binary + declaration paths (Task 3), checkbox flip (Task 3). All spec sections map to tasks.
- Type consistency: `SystemFields` defined Task 1, consumed Tasks 2+3; `assembleDocx` signature identical in Tasks 2+3; `BANNER_INTROS`/`buildRubricPage` defined and used only in Task 2.
- Test hooks: `__lastDocxDocument` (Task 2) mirrors the `__lastPptxPresentation` precedent.

## Post-implementation provenance

- GitHub issue #8: https://github.com/jeius/eduksource-ph/issues/8
- After merge: `docs/progress.md` gains the DOCX bullet under Phase 1 Track B Done (fold into PR docs commit).
