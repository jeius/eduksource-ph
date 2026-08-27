import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      {
        sessionLabel: 'Session 1',
        learningObjectives: ['identify stages'],
        learnerContext: 'visual learners',
      },
      {
        sessionLabel: 'Session 2',
        learningObjectives: ['map careers'],
        learnerContext: 'career focus',
      },
    ],
  },
  learningExperience: {
    sessions: [
      {
        sessionLabel: 'Session 1',
        preLesson: 'Greetings',
        flow: 'Teacher presents objectives.',
        learningResources: ['Slides'],
        opportunitiesForIntegration: 'N/A',
      },
      {
        sessionLabel: 'Session 2',
        preLesson: 'Recall',
        flow: 'Career mapping.',
        learningResources: [],
        opportunitiesForIntegration: 'ICT',
      },
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
      {
        sessionLabel: 'Session 1',
        extendedLearningOpportunities: 'Family walk.',
        reflections: null,
      },
      {
        sessionLabel: 'Session 2',
        extendedLearningOpportunities: 'Interview pro.',
        reflections: null,
      },
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
    const bad = structuredClone(validLessonPlan) as Omit<typeof validLessonPlan, 'waysForward'> & {
      waysForward: {
        sessions: Array<{
          sessionLabel: string;
          extendedLearningOpportunities: string;
          reflections: unknown;
        }>;
      };
    };
    const target = bad.waysForward.sessions[0];
    if (target) target.reflections = 'not null';
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
