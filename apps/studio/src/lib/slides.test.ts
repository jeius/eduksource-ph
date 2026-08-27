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
