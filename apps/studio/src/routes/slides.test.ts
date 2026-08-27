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

const VALID_DECK = {
  title: 'Understanding developmental stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding developmental stages', imagePrompt: null },
        { layout: 'objectives', heading: 'Learning Objectives', bullets: ['a', 'b'], speakerNotes: 'n1' },
        { layout: 'motivation', heading: 'Hook', bullets: ['hook question'], speakerNotes: 'n2', imagePrompt: 'opening scene' },
        { layout: 'content', heading: 'C1', bullets: ['x'], speakerNotes: 'n3', imagePrompt: 'timeline' },
        { layout: 'content', heading: 'C2', bullets: ['y'], speakerNotes: 'n4', imagePrompt: null },
        { layout: 'activity', heading: 'Activity', bullets: ['do thing'], speakerNotes: 'n5', imagePrompt: 'group work scene' },
        { layout: 'checkForUnderstanding', heading: 'Check: MCQ prompt', speakerNotes: 'n6' },
        { layout: 'closing', heading: 'Closing', bullets: ['family walk'] },
      ],
    },
  ],
};

const makeInvalidDeckJson = (): string => {
  const bad = structuredClone(VALID_DECK) as typeof VALID_DECK & {
    sessions: Array<{ slides: Array<{ layout: string } & Record<string, unknown>> }>;
  };
  // noUncheckedIndexedAccess — guard matches the 400-test's `target` pattern above.
  const badSlide = bad.sessions[0]?.slides[1];
  if (badSlide) badSlide.layout = 'hype-slide';
  return JSON.stringify(bad);
};

describe('POST /api/slides/generate — LLM + binary response', () => {
  it('happy path returns binary PPTX with metadata headers', async () => {
    mockedChatDetailed.mockResolvedValueOnce({
      content: JSON.stringify(VALID_DECK),
      usage: { input: 10, output: 10 },
      finishReason: 'stop',
      provider: 'nim',
      model: 'mock-model',
    });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('presentationml.presentation');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('x-retried')).toBe('false');
    expect(res.headers.get('x-provider')).toBe('nim');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('retries once with appended validation feedback and reports retried=true', async () => {
    mockedChatDetailed
      .mockResolvedValueOnce({ content: makeInvalidDeckJson(), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(VALID_DECK), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-retried')).toBe('true');
    expect(mockedChatDetailed).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockedChatDetailed.mock.calls.at(1)?.[0] as Array<{ role: string; content: string }>;
    const secondUserMsg = secondCallMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(secondUserMsg).toContain('Previous output failed validation');
    expect(secondUserMsg).toContain('layout');
  });

  it('502 with trimmed raw after both attempts fail validation', async () => {
    mockedChatDetailed
      .mockResolvedValueOnce({ content: makeInvalidDeckJson(), usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' })
      .mockResolvedValueOnce({ content: `${makeInvalidDeckJson()}${'x'.repeat(9000)}`, usage: {}, finishReason: 'stop', provider: 'nim', model: 'm' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(502);
    const j = (await res.json()) as { validationErrors?: string; raw?: string; provider?: string; model?: string };
    expect(j.validationErrors).toBeTruthy();
    expect((j.raw ?? '').length).toBeLessThanOrEqual(8192);
    expect(j.provider).toBe('nim');
    expect(j.model).toBe('m');
  });

  it('forwards provider/model overrides to chatDetailed', async () => {
    mockedChatDetailed.mockResolvedValueOnce({ content: JSON.stringify(VALID_DECK), usage: {}, finishReason: 'stop', provider: 'openrouter', model: 'override-model' });
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false, provider: 'openrouter', model: 'override-model' })),
    });
    expect(res.status).toBe(200);
    const firstCallOpts = mockedChatDetailed.mock.calls.at(0)?.[1] as { task?: string; model?: string };
    expect(firstCallOpts.task).toBe('lesson_plan');
    expect(firstCallOpts.model).toBe('override-model');
  });

  it('fatal provider failure yields 502 with trimmed raw', async () => {
    mockedChatDetailed.mockRejectedValue(new Error('provider chain exhausted'));
    const res = await app().request('/api/slides/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ dryRun: false })),
    });
    expect(res.status).toBe(502);
    const j = (await res.json()) as { validationErrors?: string };
    expect(j.validationErrors).toContain('provider chain exhausted');
  });
});
