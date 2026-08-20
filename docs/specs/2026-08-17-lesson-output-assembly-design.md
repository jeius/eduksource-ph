# Studio — Lesson Plan Output Assembly Spec (DOCX + PPTX)

**Status:** Accepted
**Depends on:** BOW extraction endpoint (`ExtractResponse`), `docs/specs/2026-08-17-lesson-plan-generation-design.md` (`LessonPlanResponse`), ADR-0002 (provider registry), ADR-0003 (Studio never writes to Postgres).

---

## 1. Scope

This spec covers what happens *after* the lesson-plan JSON is generated: turning it into (a) a DOCX matching the DepEd lesson-plan template, and (b) a PPTX slide deck for classroom use. Both are built inside `apps/studio`, both consume a shared input contract, and both are independent, parallelizable steps — one doesn't block the other.

Reference documents: `LP_Template_for_Orientations.pdf` (the abstract field-level template — what each section is *for*) and the real DepEd DLL sample (`ValEd-DLL-Week-1.pdf` — how schools actually lay it out in practice, specifically the **one-column-per-session table structure**). The output should follow the real sample's layout, since that's what "closely to the example" means in practice — the abstract template describes intent, the sample shows the actual document shape.

---

## 2. Shared constants

```ts
// packages/schemas/src/studio-constants.ts
export const TEACHER_FILL_BLANK = "＿＿＿＿＿＿＿＿＿＿＿＿＿＿"; // visual blank line
export const TEACHER_FILL_NOTE = "[To be completed by the teacher after the session]";
```

**Used in DOCX only.** PPTX slides are AI-generated instructional content for students, not an admin form — there's nothing on a slide that's "filled in later" the way Reflections or a signature line is. Don't carry the placeholder concept into the PPTX generator; it doesn't apply there.

---

## 3. Input contract

Both generators take the same `AssemblyInput` — one source of truth, so DOCX and PPTX can never silently drift out of sync on the underlying lesson content.

```ts
type SystemFields = {
  teacherName: string | null;       // null → render TEACHER_FILL_BLANK
  sectionLabel: string | null;      // null → render TEACHER_FILL_BLANK
  gradeLevel: string;               // from ExtractResponse.document.gradeLevel
  learningArea: string;             // from ExtractResponse.document.learningArea
  generationMetadata: {
    provider: string;
    model: string;
    generatedAt: string;            // ISO timestamp
  };
  bowReference: string;             // system-appended, e.g. "Official DepEd Three-Term Budget of Work — Term 1, Week 3"
};

type AssemblyInput = {
  lessonPlan: LessonPlanResponse;   // DOCX-facing — see §4
  slideDeck: SlideDeckSpec;         // PPTX-facing — see §5
  systemFields: SystemFields;
};
```

`lessonPlan` and `slideDeck` come from **two separate generation calls** against the same filtered BOW context (§2 of the earlier lesson-plan design). This is the resolution to the Flow-vs-slides problem — see §5.1 for why.

---

## 4. DOCX Assembly

### 4.1 Document outline

1. **Letterhead** — *deferred, out of scope for this endpoint.* The sample includes a DepEd region/division/school header block with logos. That's school-specific static configuration, not generated content. `AssemblyInput` should accept an optional `letterhead` block (defaults to none) so this can be wired in later without a schema change.
2. **Header info table** (2-column key/value)
3. **Main body table** — one row-group per template section, one column per session
4. **Signature block** (Prepared by / Checked by / Noted)
5. **Self-check rubric page** — static, identical across every generated document (see §4.4)

### 4.2 Header table → field mapping

| Row label | Source |
| --- | --- |
| Lesson Title | `lessonPlan.meta.lessonTitle` |
| Learning Area/s | `systemFields.learningArea` |
| Name of Teacher/s | `systemFields.teacherName` ?? `TEACHER_FILL_BLANK` |
| Grade Level and Section | `${systemFields.gradeLevel} ${systemFields.sectionLabel ?? TEACHER_FILL_BLANK}` |
| No. of Sessions | `lessonPlan.meta.numberOfSessions` |
| References | `systemFields.bowReference` + `lessonPlan.meta.referencesFromBow` (system-appended first, AI-suggested after) |
| Declaration of AI use | System-templated string, parameterized with `systemFields.generationMetadata` — **not** free-written by the model. Template: *"AI tools ({model} via {provider}) were used to assist in organizing lesson components and formatting this lesson plan based on curriculum standards, following DO 3 s.2026 Annex A. All content was reviewed, contextualized, and validated by the facilitator prior to use."* |

### 4.3 Main body table → field mapping

One label column + N session columns (N = `lessonPlan.meta.numberOfSessions`). Section-divider rows (shaded, full-width merged cell with the template's descriptive intro text) precede each group, matching the sample's "Intentions." / "Learning Experience." / "Assessment." / "Ways Forward." banner rows.

| Section banner | Row label | Source (per session `i`) |
| --- | --- | --- |
| *Intentions.* | Learning Competency and Curriculum Standards | `lessonPlan.intentions.learningCompetencyAndStandards` (same across sessions unless the block genuinely varies — usually one merged cell spanning all columns, not repeated per column) |
| | Learning Objectives | `lessonPlan.intentions.sessions[i].learningObjectives` |
| | Learner Context | `lessonPlan.intentions.sessions[i].learnerContext` |
| *Learning Experience.* | Pre-Lesson | `lessonPlan.learningExperience.sessions[i].preLesson` |
| | Flow | `lessonPlan.learningExperience.sessions[i].flow` |
| | Learning Resources | `lessonPlan.learningExperience.sessions[i].learningResources` |
| | Opportunities for integration | `lessonPlan.learningExperience.sessions[i].opportunitiesForIntegration` |
| *Assessment.* | Formative Assessment | `lessonPlan.assessment.sessions[i].formativeAssessment` |
| *Ways Forward.* | Extended learning opportunities | `lessonPlan.waysForward.sessions[i].extendedLearningOpportunities` |
| | Reflections | **Always** `TEACHER_FILL_NOTE` — never sourced from the model, see §2 |

### 4.4 Static rubric page

The self-check/peer-coaching rubric is identical on every output — it doesn't depend on lesson content. Build it once as a reusable fragment function (`buildRubricPage(): (Paragraph | Table)[]`) and append it via a `PageBreak`, rather than treating it as something to regenerate or vary per document. One function, called on every assembly — don't let this drift into per-lesson variation by accident.

### 4.5 docx-js implementation notes

- **Table widths:** set `columnWidths` on both tables AND `width` on every cell, in `WidthType.DXA` — never `PERCENTAGE` (breaks in Google Docs, per skill). Column widths must sum to the table width. With N session columns, compute `sessionColWidth = (tableWidth - labelColWidth) / N`.
- **Section-banner shading:** `ShadingType.CLEAR`, never `SOLID` (renders black).
- **Signature block:** 3-column table (Prepared by / Checked by / Noted), each cell = name (real value if `systemFields` supplies one, else `TEACHER_FILL_BLANK`) + role/title on the line below.
- **Page size:** A4.
- **Page break before the rubric page:** `PageBreak` inside a `Paragraph`, not standalone.
- **Never `\n`** — every line is its own `Paragraph`.

### 4.6 Verification

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.docx
pdftoppm -jpeg -r 100 output.pdf page
```

View the rendered pages and compare against the DLL sample's layout before considering the assembler done — table alignment and shading are the most likely first-pass defects.

---

## 5. PPTX Assembly

### 5.1 Why slide content is a separate generation, not a derivation

`lessonPlan.learningExperience.sessions[i].flow` is written **for the teacher performing the lesson** — "make objectives clear before the task," "check well-being mid-session." It is not what a student should see projected on a screen. Slicing that text onto slide bullets would put the teacher's stage directions in front of the class.

Instead, slide content comes from its own generation call — **fed by the generated `LessonPlanResponse`, not by the raw BOW context again.** This is a deliberate sequencing choice, not just an input swap: if slide generation ran independently off the BOW (in parallel with lesson-plan generation, as an earlier draft of this spec had it), nothing would guarantee the slides describe the same activities, objectives phrasing, or emphasis the lesson plan actually settled on — two independent generations from the same source can still drift from each other. For a bundled product where the lesson plan, deck, and exam are supposed to describe *the same lesson*, that drift is a real defect, not a cosmetic one. Chaining `LessonPlanResponse → SlideDeckSpec` guarantees the slides reflect the specific lesson that was actually produced, and sets up a natural "regenerate slides from the edited plan" action once an editor makes changes during review — the dependency is already there.

```ts
type SlideDeckSpec = {
  title: string;
  sessions: {
    sessionLabel: string;
    slides: {
      layout: "title" | "objectives" | "content" | "activity" | "checkForUnderstanding" | "closing";
      heading: string;
      bullets?: string[];
      speakerNotes?: string;        // see §5.2 — this is where Flow actually lives
      imagePrompt?: string | null;  
    }[];
  }[];
};
```

This task is mostly restructuring/condensing rather than original pedagogical writing — a good candidate for the cheaper model tier in your provider registry (e.g. DeepSeek V3.2 or GPT-5.4 Nano from the earlier comparison) even when the lesson-plan generation itself uses a stronger model.

### 5.2 Connecting the two outputs: speaker notes

Rather than discarding the detailed `Flow` narrative when building the PPTX, use it as the connective tissue: **`speakerNotes` on the corresponding slide should draw from `lessonPlan.learningExperience.sessions[i].flow`**, condensed to the relevant portion for that slide. The slide face shows condensed, visual, student-facing content; the speaker notes give the teacher the same pedagogical guidance that's in the DOCX, available while presenting. One underlying lesson, correctly separated by audience.

### 5.3 Image generation

Only slides with a non-null `imagePrompt` trigger an image call — most slides (title, objectives, activity-instruction slides) don't need one. Route through the image provider chosen per the earlier comparison (GPT Image 1 Mini as default, Ideogram 3.0 for any slide whose `imagePrompt` implies labeled text in the image, e.g. a labeled diagram). This is a different endpoint shape than the chat-completion provider registry — needs its own thin adapter, not the same `openai`-client-with-different-baseURL trick (per ADR-0002's note on this).

### 5.4 pptxgenjs implementation notes

- **Set `pres.layout` before adding any slide.** Use `LAYOUT_WIDE` (13.3″×7.5″) — the default `LAYOUT_16x9` is 10″ wide and silently clips anything placed past the edge.
- **Hex colors:** no `#`, no 8-digit/alpha-baked hex — either corrupts the file. Use `transparency`/`opacity` options instead.
- **Fresh options object per slide** — pptxgenjs mutates option objects in place (EMU conversion); never reuse one `shadow`/options object across multiple `add*` calls.
- **Lists:** `bullet: true` per item, never a literal `•`; `breakLine: true` on every item except the last.
- **Speaker notes:** `slide.addNotes(text)` — plain text, never a text box on the slide face.
- **One `new pptxgen()` per output file.**
- **Design rules to actually follow** (per skill's design guidance, worth restating since it's easy to default into the boring version): no accent lines under titles, no decorative color bars/stripes (these read as AI-generated filler), avoid cream/beige defaults — use white or a real palette choice, vary layouts per slide type rather than titles-and-bullets throughout.

### 5.5 QA (required, not optional)

```bash
markitdown output.pptx | grep -iE "\bx{3,}\b|lorem|ipsum|\bTODO|\[insert"
python scripts/office/validate.py output.pptx
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
```

Then visually check every slide — overflow/cut-off text is the single most common defect and the first thing to check. For Phase 1, machine-checkable QA (`validate.py` + the grep) runs automatically inside the pipeline; full visual QA is the human editor's job during review, which is the whole point of keeping a human in the loop — don't try to automate that away yet.

---

## 6. Pipeline sequencing

```txt
1. Extract (cached by extractionId)
2. Generate LessonPlanResponse (DOCX-facing)     ← filtered BOW context
3. Generate SlideDeckSpec (PPTX-facing)          ← LessonPlanResponse, NOT the raw BOW again (§5.1)
4. ┌─ Assemble DOCX (pure code, no AI)                        ─┐
   └─ Generate per-slide images → Assemble PPTX (code + images) ┘  — run in parallel, both depend only on the generation outputs from steps 2–3
5. Upload both files to R2
6. Return R2 keys + generation metadata to admin → api's POST /internal/products (ADR-0003)
```

Steps 2 and 3 are sequential by design (§5.1) — the small latency cost buys content consistency between the two deliverables, which matters more here than shaving a few seconds off a low-frequency internal pipeline. Step 4's two branches still parallelize freely even under the Phase 1 synchronous model (no job queue needed yet, per `PROJECT_PLAN.md` §6.3), since neither assembly step depends on the other.

---

## 7. Open items

- **Paper size (A4 vs Letter)** for the DOCX — **Resolved:** A4 is the default paper size of DepEd samples.
- **Letterhead** handling — needs an admin-configurable header asset before this goes near a real school deployment; not blocking for prototype.
- **Rubric page universality** — assumed generic/reusable across learning areas based on the sample; flag if that assumption turns out wrong for a different learning area's BOW.
