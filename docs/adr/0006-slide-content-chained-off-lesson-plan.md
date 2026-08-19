# ADR-0006: Slide Content Is Generated From the Lesson Plan, Not the Raw BOW — Flow Becomes Speaker Notes

**Status:** Accepted
**Date:** 2026-08-17

## Context

Studio produces two AI-generated artifacts from the same underlying lesson: a DOCX lesson plan (`LessonPlanResponse`) and a PPTX slide deck (`SlideDeckSpec`). Two design questions had to be resolved together, because getting either one wrong independently produces a broken deck:

1. **What generates the slide content?** `LessonPlanResponse.learningExperience.sessions[i].flow` is written *for the teacher performing the lesson* — "make objectives clear before the task," "check well-being mid-session," the kind of stage direction a teacher needs and a student should never see. Mechanically slicing that text onto slide bullets would put the teacher's instructions on-screen in front of the class.
2. **Where does the slide-generation call get its source material?** An earlier draft of this design had `SlideDeckSpec` generated in parallel with `LessonPlanResponse`, both independently off the raw BOW context. That's faster (parallel AI calls) but has no mechanism to keep the two outputs consistent — two independent generations from the same source can still land on different activities, phrasing, or emphasis, which is a real defect for a bundled product where the lesson plan and deck are supposed to describe *the same lesson*.

## Decision

`SlideDeckSpec` generation is **chained off the generated `LessonPlanResponse`**, not run independently in parallel off the raw BOW context. Slide face content (`heading`, `bullets`, `layout`) is a separate, condensed, student-facing structure — never a direct rendering of `flow`. The detailed `flow` narrative instead becomes the slide's **speaker notes** (`slide.addNotes()` in pptxgenjs), giving the teacher the same pedagogical detail that's in the DOCX while presenting, without ever putting it in front of students.

```txt
Generate LessonPlanResponse  ← filtered BOW context
Generate SlideDeckSpec       ← LessonPlanResponse (sequential, not parallel)
```

## Alternatives Considered

- **Mechanically slice `flow` text onto slide bullets** — rejected outright. Wrong audience; puts teacher stage-direction language in front of students.
- **Generate `SlideDeckSpec` in parallel with `LessonPlanResponse`, both off the raw BOW context** — rejected. Faster, but nothing guarantees the two outputs describe the same lesson; independent generations from the same source material can still drift from each other in activities, phrasing, or emphasis. For a product where the deck and lesson plan are sold as a matched set, that drift is a real defect, not a latency optimization worth keeping.
- **Discard `flow` entirely when building the PPTX** — rejected. Wastes a genuinely useful piece of already-generated content; the teacher still needs that guidance while presenting, it just doesn't belong on the slide face.

## Consequences

**Gets easier:**

- The deck and the lesson plan are guaranteed to describe the same actual lesson, not two independently-imagined versions of it.
- Sets up a natural future action — "regenerate slides from the edited lesson plan" — once an editor makes changes during review, since slide generation already depends on the lesson plan as input rather than on a separate run of the original extraction.
- Correct audience separation is structural, not a prompting convention someone has to remember to apply consistently: student-facing content and teacher-facing content live in different fields by construction.

**Gets harder / new obligations:**

- The two AI calls are sequential, not parallel — a small latency cost, accepted deliberately because Studio is a low-frequency internal tool where consistency matters more than shaving a few seconds off one generation run (see `docs/specs/lesson-output-assembly-spec.md` §6).
- `SlideDeckSpec` is a second schema to maintain alongside `LessonPlanResponse`, and the slide-generation prompt needs to correctly condense `flow` into per-slide speaker notes rather than copying it wholesale — a prompting detail worth testing directly, not just assuming works.

**See also:** `docs/specs/lesson-output-assembly-spec.md` §5, which this ADR summarizes the reasoning for.
