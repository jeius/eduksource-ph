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
      requested === null ? 'No sessions found in lesson plan' : `Session "${requested}" not found`
    );
    this.name = 'SessionNotFoundError';
    this.availableSessions = available;
  }
}

export function selectSession(lp: LessonPlanResponse, sessionLabel?: string): SelectedSession {
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
