Status: ready-for-agent

## Problem Statement

Teachers and DepEd reviewers need the lesson plan as a formal Word document — the format schools actually file, print, and submit. The PPTX deck (just shipped) serves classroom projection, but the DLL (Daily Lesson Log) document is the compliance artifact: a 7-row header table, one main body table with a column per session, a 3-person signature block, and a static self-check rubric page. Editors need to download this `.docx` directly from the studio pipeline and review it, matching how the real ValEd DLL samples are laid out.

## Solution

A synchronous `POST /api/docx/generate` route in `apps/studio` that takes a reviewed `LessonPlanResponse` (validated against the shared Zod schema) plus `extractionId` (for gradeLevel/learningArea) and optional `systemFields`, and assembles a binary DOCX via the `docx` npm package — **pure deterministic code, zero AI calls** (assembly spec §6 step 4). Unlike the PPTX slice there is no `dryRun` and no session selection: the DLL renders **all N sessions** as columns in one table, and the editor reviews the actual file. Output: binary `lesson-plan.docx` with `Content-Disposition: attachment` and `X-Generated-At` header.

`SystemFields` is promoted to `packages/schemas` as the single shared contract for both assemblers (spec §3: "one source of truth, so DOCX and PPTX can never silently drift"), extended with signature-block fields (preparedBy/checkedBy/notedBy + roles) and a stubbed optional `letterhead` block so future wiring is a config change, not a schema change.

## User Stories

1. As an editor, I want to pass a reviewed `LessonPlanResponse` to a DOCX route and receive a downloadable `.docx` file, so that I can review and file the formal lesson plan document.
2. As an editor, I want the document to render all N sessions as columns in one table, so that it matches the DepEd DLL format teachers submit.
3. As an editor, I want the 7-row header table (Lesson Title, Learning Area/s, Name of Teacher/s, Grade Level and Section, No. of Sessions, References, Declaration of AI use), so that the document carries the required metadata.
4. As an editor, I want the Declaration of AI use system-templated with the actual provider/model used, so that it follows DO 3 s.2026 Annex A without the model free-writing it.
5. As an editor, I want `teacherName`/`sectionLabel` to render as fill-in-the-blank lines when not provided, so that a teacher can complete them by hand.
6. As an editor, I want a 3-person signature block (Prepared by / Checked by / Noted) with roles, so that the document matches real school sign-off chains.
7. As an editor, I want the self-check rubric page appended after a page break, so that the document includes the peer-coaching self-check from the DepEd template.
8. As an editor, I want the Reflections row to always show a "to be completed" note, so that the AI never fills teacher-owned fields.
9. As an editor, I want the learning competency row merged across all session columns, so that identical standards text isn't repeated N times.
10. As an editor, I want shaded section banner rows (Intentions / Learning Experience / Assessment / Ways Forward) with the template's descriptive intro text, so that the document reads like the official template.
11. As an editor, I want numbered references (BOW first, AI-suggested after), so that the references cell matches the DLL sample.
12. As an editor, I want optional letterhead lines rendered centered above the header table when configured, so that a school can brand its documents later without schema changes.
13. As an editor, I want `410 Gone` when the `extractionId` has expired, so that I know to re-upload the BOW.
14. As an editor, I want `400 Bad Request` when the lessonPlan fails validation, so that I fix the input before assembly.
15. As a developer, I want `SystemFields` promoted to the shared schemas package, so that DOCX and PPTX assembly consume one contract and cannot drift.
16. As a developer, I want the assembler as a pure function separate from the route, so that I can unit-test document structure without HTTP.
17. As a developer, I want A4 page size with DXA column widths on every table, so that the layout renders correctly in Word and Google Docs.

## Implementation Decisions

- **New route** `POST /api/docx/generate` in `apps/studio`: request `{ lessonPlan: LessonPlanResponse (Zod-validated), extractionId, termLabel, weekLabel, systemFields? }`; response binary DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="lesson-plan.docx"`, `X-Generated-At` ISO header). Errors: `410 {code:'EXTRACTION_EXPIRED'}` on cache miss; `400` on invalid lessonPlan. No dryRun, no session selection, no provider/model overrides (zero AI calls).
- **New assembler** `assembleDocx(lessonPlan, systemFields): Promise<Buffer>` in studio lib — pure function over the `docx` npm package (^9.x). Document outline per assembly spec §4.1: optional letterhead block (centered lines), 7-row header info table (2-col), main body table (label column + N session columns), signature block (3-column table), page break, static rubric page.
- **Header table mapping** (spec §4.2): Lesson Title ← `lessonPlan.meta.lessonTitle`; Learning Area/s ← `systemFields.learningArea`; Name of Teacher/s ← `teacherName ?? TEACHER_FILL_BLANK`; Grade Level and Section ← `${gradeLevel} ${sectionLabel ?? TEACHER_FILL_BLANK}`; No. of Sessions ← `meta.numberOfSessions`; References ← numbered paragraphs (`1.` bowReference, then `2.`+ per `referencesFromBow`); Declaration of AI use ← system-templated: "AI tools ({model} via {provider}) were used to assist in organizing lesson components and formatting this lesson plan based on curriculum standards, following DO 3 s.2026 Annex A. All content was reviewed, contextualized, and validated by the facilitator prior to use."
- **Main body table** (spec §4.3): shaded full-width merged banner rows (`ShadingType.CLEAR` + `D9D9D9` fill, never SOLID) preceding each section group, each with italicized section label + the verbatim intro text from `LP_Template_for_Orientations.pdf` (Intentions. / Learning Experience. / Assessment. / Ways Forward. — extracted from template P2-P4). Learning Competency row = one merged cell spanning all N session columns (`columnSpan: N`) with CS/PS/LC paragraphs. Per-session rows: Learning Objectives, Learner Context, Pre-Lesson, Flow, Learning Resources, Opportunities for integration, Formative Assessment, Extended learning opportunities. Reflections row = **always** `TEACHER_FILL_NOTE` per session, never model-sourced.
- **Signature block** (spec §4.5): 3-column table — Prepared by ← `preparedBy ?? teacherName ?? TEACHER_FILL_BLANK`; Checked by ← `checkedBy ?? TEACHER_FILL_BLANK`; Noted ← `notedBy ?? TEACHER_FILL_BLANK`; role line under each when role fields provided (DLL: Teacher II / Head Teacher III / Principal IV).
- **Rubric page** (spec §4.4): `buildRubricPage(): (Paragraph|Table)[]` static fragment — title "RUBRIC FOR LESSON PLANNING SELF-CHECK AND/OR PEER COACHING", 9 self-check rows (extracted verbatim from template P5) with Yes/Not Yet/Why columns, "Notes for my instructional coaching session:" line. Identical across every document; appended after a `PageBreak` inside a Paragraph (never standalone).
- **`SystemFields` promotion**: new shared Zod schema in `packages/schemas` (system-fields module) — `teacherName/sectionLabel: string|null`, `gradeLevel/learningArea/bowReference: string`, `generationMetadata {provider, model, generatedAt}`, new optionals `preparedBy/checkedBy/notedBy: string|null` and `checkedByRole/notedByRole: string|null`, `letterhead: {lines: string[]}|null`. `lib/pptx.ts` refactored to import the shared type (call sites unchanged — new fields optional with defaults).
- **docx implementation rules** (spec §4.5, binding): `columnWidths` set on both tables AND `width` on every cell in `WidthType.DXA` (never percentage — breaks Google Docs); widths sum to table width, `sessionColWidth = (tableWidth - labelColWidth) / N`; A4 page size; every line its own Paragraph (never `\n`); one `new Document()` per output.
- **Errors/status parity**: warn-only `x-internal-token` logging (Phase 2 hardens); `TODO(ADR-0008)` file-hash alias comment carried.

## Testing Decisions

Only external behavior: route status codes/content-types/headers; assembler output is a valid non-empty DOCX (PK zip signature) whose serialized XML contains the controlled strings we pass in (titles, labels, fill blanks, declaration fragments). No assertions on docx library internals.

- **Task A schema tests** (packages/schemas): shared SystemFieldsSchema accepts full shape + minimal shape; defaults behavior via plain TS (schema is structural).
- **Seam 1 — assembler unit** (`apps/studio/src/lib/docx.test.ts`): non-empty buffer with PK signature; XML contains lessonTitle; all N session labels present; `TEACHER_FILL_NOTE` appears once per session (Reflections); `TEACHER_FILL_BLANK` when names null; Declaration contains `{model} via {provider}`; 9 rubric rows present; letterhead lines render when provided; numbered references (`1.` bowReference first).
- **Seam 2 — route integration** (`apps/studio/src/routes/docx.test.ts`): `app.request()` with `vi.hoisted` mocks (extractionCache, providers window) — 410 expired, 400 invalid lessonPlan (reflections 'not null'), happy path binary w/ correct content-type + Content-Disposition + X-Generated-At. No LLM mocks (no AI calls).
- Prior art: `apps/studio/src/routes/slides.test.ts` (mock pattern), `apps/studio/src/lib/pptx.test.ts` (assembler assertions pattern).

## Out of Scope

- Letterhead data source (field stubbed only; config wiring is Phase 5 admin).
- R2 upload, `POST /internal/products`, admin review/publish (Phase 5).
- Visual QA tooling `soffice`/`pdftoppm` render verification (spec §4.6) — deferred to the manual e2e checkbox.
- `extractionId` durability (`TODO(ADR-0008)`, Phase 5).
- Summative/term test route (next checkbox after this).
- Service-token hardening (Phase 2).

## Further Notes

- Assembly spec §4.6 verification (convert to PDF, visual check vs DLL sample) rides with the manual e2e checkbox, not this slice.
- The `docx` npm package current major is 9.x (^9.7.1).
- Banner intro texts are captured verbatim in this spec's source (template P2-P4); implementers copy them from the plan, which will carry the exact strings.
- Route path uses `/api/docx/generate` (not `/api/lesson-plans/:id/docx`) — lesson plan is an input, not a parent resource; mirrors the slides route precedent.

---
Provenance: GitHub issue https://github.com/jeius/eduksource-ph/issues/8 (id 5268884176) created via mcpproxy github:issue_write method:create owner:jeius repo:eduksource-ph on 2026-08-27.
