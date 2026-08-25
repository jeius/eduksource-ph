import { describe, expect, it } from 'vitest';
import { LessonPlanResponseSchema } from './lesson-plan.js';

const valid = {
  meta: {
    lessonTitle: 'Understanding developmental stages',
    numberOfSessions: 4,
    referencesFromBow: ['https://quexbook.app/educator/lessons/daaa9e47'],
  },
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: ['CS1'],
      performanceStandard: ['PS1'],
      learningCompetency: 'Examine sense of self',
    },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages'], learnerContext: 'aware but need specifics' },
      { sessionLabel: 'Session 2', learningObjectives: ['explain Super exploration'], learnerContext: 'G11 exploring careers' },
      { sessionLabel: 'Session 3', learningObjectives: ['analyze scenarios'], learnerContext: 'analyze real cases' },
      { sessionLabel: 'Session 4', learningObjectives: ['articulate Erikson-Super link'], learnerContext: 'vision board reflection' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings & Recall', flow: 'Teacher presents objectives… peer sharing 2 min…', learningResources: ['Powerpoint', 'Pictures'], opportunitiesForIntegration: 'Social Studies: cultural influences' },
      { sessionLabel: 'Session 2', preLesson: 'Peer Interview', flow: 'Teacher explains Exploration… Life Rainbow…', learningResources: ['Powerpoint'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 3', preLesson: 'Picture Analysis', flow: 'Scenario Analysis … skits…', learningResources: ['Materials'], opportunitiesForIntegration: 'Language: skits' },
      { sessionLabel: 'Session 4', preLesson: 'Story Spotlight Hidilyn', flow: 'Synthesis … success board…', learningResources: ['Board'], opportunitiesForIntegration: 'ICT: TikTok tagline' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: '1. According to Erikson… A-D … 5 questions' },
      { sessionLabel: 'Session 2', formativeAssessment: '1. What are 5 Super stages? 2. Which stage… — open questions' },
      { sessionLabel: 'Session 3', formativeAssessment: 'Case Marco/Madel: risk factor… scenario Qs' },
      { sessionLabel: 'Session 4', formativeAssessment: 'Reflective: How does understanding stage help…' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Observe family… journal', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Video log …', reflections: null },
      { sessionLabel: 'Session 3', extendedLearningOpportunities: 'Watch Inside Out …', reflections: null },
      { sessionLabel: 'Session 4', extendedLearningOpportunities: 'Legacy Tagline commercial …', reflections: null },
    ],
  },
};

describe('LessonPlanResponseSchema', () => {
  it('accepts Week-1-shaped 4×3 valid fixture', () => {
    expect(() => LessonPlanResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects reflections != null with correct path', () => {
    const bad = {
      ...valid,
      waysForward: {
        sessions: [
          {
            ...valid.waysForward.sessions[0]!,
            // intentional invalid value: reflections must be null
            reflections: 'oops' as unknown as null,
          },
        ],
      },
    };
    const r = LessonPlanResponseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]!.path.join('.')).toContain('reflections');
  });

  it('rejects empty formativeAssessment', () => {
    const bad = {
      ...valid,
      assessment: { sessions: [{ sessionLabel: 'Session 1', formativeAssessment: '' }] },
    };
    expect(LessonPlanResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts N/A for opportunitiesForIntegration', () => {
    const na = { ...valid, learningExperience: { sessions: valid.learningExperience.sessions } };
    expect(LessonPlanResponseSchema.safeParse(na).success).toBe(true);
  });
});
