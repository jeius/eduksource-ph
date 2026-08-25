import { z } from 'zod';

/**
 * Shared LessonPlanResponse contract (docs/specs/2026-08-25-lesson-plan-generation-spec.md).
 * Consumed by studio generation and later DOCX/PPTX assembly (`AssemblyInput`).
 *
 * Prose strings are permissive; `reflections` is strict `z.null()` — the teacher
 * fills it after delivery, the AI must never populate it.
 */

const proseString = z.string().min(1);

export const LearningCompetencyAndStandardsSchema = z.object({
  contentStandard: z.array(z.string()),
  performanceStandard: z.array(z.string()),
  learningCompetency: z.string().min(1),
});

export const IntentionsSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)).min(1),
  learnerContext: z.string().min(1),
});

export const LearningExperienceSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  preLesson: z.string().min(1),
  flow: z.string().min(1),
  learningResources: z.array(z.string()),
  opportunitiesForIntegration: z.string().min(1),
});

export const AssessmentSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  formativeAssessment: proseString,
});

export const WaysForwardSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  extendedLearningOpportunities: z.string().min(1),
  reflections: z.null(),
});

export const LessonPlanResponseSchema = z.object({
  meta: z.object({
    lessonTitle: z.string().min(1),
    numberOfSessions: z.number().int().min(1),
    referencesFromBow: z.array(z.string()),
  }),
  intentions: z.object({
    learningCompetencyAndStandards: LearningCompetencyAndStandardsSchema,
    sessions: z.array(IntentionsSessionSchema).min(1),
  }),
  learningExperience: z.object({
    sessions: z.array(LearningExperienceSessionSchema).min(1),
  }),
  assessment: z.object({
    sessions: z.array(AssessmentSessionSchema).min(1),
  }),
  waysForward: z.object({
    sessions: z.array(WaysForwardSessionSchema).min(1),
  }),
});

export type LessonPlanResponse = z.infer<typeof LessonPlanResponseSchema>;
export type IntentionsSession = z.infer<typeof IntentionsSessionSchema>;
export type LearningExperienceSession = z.infer<typeof LearningExperienceSessionSchema>;
export type AssessmentSession = z.infer<typeof AssessmentSessionSchema>;
export type WaysForwardSession = z.infer<typeof WaysForwardSessionSchema>;
