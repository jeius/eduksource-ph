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

// Task 3: chatDetailed is not yet wired — mock and assert never called on dryRun
const { mockedChatDetailed } = vi.hoisted(() => ({ mockedChatDetailed: vi.fn() }));
vi.mock('../lib/ai/client.js', () => ({ chatDetailed: mockedChatDetailed }));

import { createLessonPlanRoutes } from './lesson-plan.js';

function app() {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('logger' as never, createSilentLogger());
    await next();
  });
  a.route('/api/lesson-plans', createLessonPlanRoutes());
  return a;
}

const validDoc = {
  learningArea: 'Life and Career Skills',
  gradeLevel: 'Grade 11',
  documentNotes: null,
  terms: [
    {
      termLabel: 'First Term',
      contentStandard: ['CS term'],
      performanceStandard: ['PS term'],
      skillsFocus: null,
      suggestedActivities: ['Act'],
      suggestedPerformanceTasks: ['Task'],
      blocks: [
        {
          weekLabel: 'Week 1',
          durationDays: 4,
          contentStandard: ['CS block'],
          performanceStandard: ['PS block'],
          skillsFocus: null,
          strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '1. Competency…' }],
          extractionNotes: null,
        },
      ],
    },
  ],
};

function cachedExtraction() {
  return { text: '', pages: 1, document: validDoc, warnings: [], notes: [] };
}

describe('POST /api/lesson-plans/generate — scoping & dryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    windowHolder.value = 128_000;
  });

  it('410 when extractionId not in cache', async () => {
    mockedExtractionCache.get.mockReturnValue(undefined);
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionId: 'abc123',
        termLabel: 'First Term',
        weekLabel: 'Week 1',
      }),
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code?: string }).code).toBe('EXTRACTION_EXPIRED');
  });

  it('404 with availableTerms when termLabel misses', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'Nope', weekLabel: 'Week 1' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { availableTerms?: string[] }).availableTerms).toEqual([
      'First Term',
    ]);
  });

  it('404 with availableWeeks when weekLabel misses', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 9' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { availableWeeks?: string[] }).availableWeeks).toEqual([
      'Week 1',
    ]);
  });

  it('dryRun returns prompts without calling chatDetailed', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionId: 'abc',
        termLabel: 'First Term',
        weekLabel: 'Week 1',
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(typeof j.systemPrompt).toBe('string');
    expect(typeof j.userPrompt).toBe('string');
    expect(typeof j.estimatedTokens).toBe('number');
    expect(typeof j.maxCompletionTokens).toBe('number');
    expect(mockedChatDetailed).not.toHaveBeenCalled();
  });

  it('sessionsOverride 0 or above 7 is 400', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    for (const n of [0, 8, 99]) {
      const res = await app().request('/api/lesson-plans/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          extractionId: 'abc',
          termLabel: 'First Term',
          weekLabel: 'Week 1',
          sessionsOverride: n,
        }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('block overrides term (block CS used in filtered slice)', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        extractionId: 'abc',
        termLabel: 'First Term',
        weekLabel: 'Week 1',
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { userPrompt: string };
    expect(j.userPrompt).toContain('CS block'); // block's CS wins over term-level alone
  });
});

const validLessonPlan = {
  meta: {
    lessonTitle: 'Understanding developmental stages',
    numberOfSessions: 4,
    referencesFromBow: ['https://example.com/a'],
  },
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: ['CS1'],
      performanceStandard: ['PS1'],
      learningCompetency: 'Examine sense of self',
    },
    sessions: [
      { sessionLabel: 'Session 1', learningObjectives: ['identify stages', 'describe characteristics', 'reflect on importance'], learnerContext: 'aware but need specifics - visual learners' },
      { sessionLabel: 'Session 2', learningObjectives: ['explain Super exploration', 'demonstrate mapping', 'reflect on uncertainties'], learnerContext: 'G11 exploring careers, needs career relevance' },
      { sessionLabel: 'Session 3', learningObjectives: ['analyze dilemmas', 'perform skits', 'demonstrate empathy'], learnerContext: 'real scenarios help see protective factors' },
      { sessionLabel: 'Session 4', learningObjectives: ['articulate Erikson-Super link', 'create vision statements', 'express aspirations'], learnerContext: 'vision board fosters self-awareness' },
    ],
  },
  learningExperience: {
    sessions: [
      { sessionLabel: 'Session 1', preLesson: 'Greetings & Recall', flow: 'Teacher presents objectives → wellness check → How well do you know yourself? … peer sharing 2 min… guided discussion … inclusion …'.repeat(2), learningResources: ['Powerpoint', 'Pictures'], opportunitiesForIntegration: 'Social Studies: cultural influences' },
      { sessionLabel: 'Session 2', preLesson: 'Peer Interview', flow: 'Teacher explains Super Exploration … Life Rainbow chart … wellness on tentative choices …', learningResources: ['Materials'], opportunitiesForIntegration: 'N/A' },
      { sessionLabel: 'Session 3', preLesson: 'Picture Analysis', flow: 'Teacher reviews Erikson vs Super … Scenario Analysis groups … Discussion Qs …', learningResources: ['Scenarios'], opportunitiesForIntegration: 'Language: skits' },
      { sessionLabel: 'Session 4', preLesson: 'Story Spotlight Hidilyn', flow: 'Synthesis … Success Markers … vision board creation … reflection …', learningResources: ['Board', 'Markers'], opportunitiesForIntegration: 'ICT: TikTok tagline' },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: 'MCQ 1. Erikson task of adolescence? A Trust B Identity … — 5 questions with accommodations' },
      { sessionLabel: 'Session 2', formativeAssessment: 'Short answer: 5 Super stages… Establishment vs Maintenance — varied format' },
      { sessionLabel: 'Session 3', formativeAssessment: 'Scenario Q: Marco risk factor… Madel protective factor… — case-based' },
      { sessionLabel: 'Session 4', formativeAssessment: 'Reflective: How does stage help career decisions… — personal plan' },
    ],
  },
  waysForward: {
    sessions: [
      { sessionLabel: 'Session 1', extendedLearningOpportunities: 'Observe family … journal log…', reflections: null },
      { sessionLabel: 'Session 2', extendedLearningOpportunities: 'Video log of behaviors …', reflections: null },
      { sessionLabel: 'Session 3', extendedLearningOpportunities: 'Watch Inside Out and write analysis…', reflections: null },
      { sessionLabel: 'Session 4', extendedLearningOpportunities: 'Legacy Tagline commercial … post on forum…', reflections: null },
    ],
  },
} satisfies Record<string, unknown>;

/** Clone of validLessonPlan with an invalid (non-null) reflections value — fails Zod. */
function invalidPlanJson(reflections: unknown): string {
  const bad = JSON.parse(JSON.stringify(validLessonPlan)) as {
    waysForward: { sessions: Array<{ reflections: unknown }> };
  };
  const firstSession = bad.waysForward.sessions.at(0);
  if (!firstSession) throw new Error('fixture missing');
  firstSession.reflections = reflections;
  return JSON.stringify(bad);
}

describe('POST /api/lesson-plans/generate — LLM + validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path 200 with lessonPlan + generationMetadata.retried false', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    mockedChatDetailed.mockResolvedValueOnce({
      content: JSON.stringify(validLessonPlan),
      usage: { input: 10, output: 10 },
      finishReason: 'stop',
    });
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { lessonPlan: { meta: { numberOfSessions: number } }; generationMetadata: { retried: boolean; provider: string } };
    expect(j.lessonPlan.meta.numberOfSessions).toBe(4);
    expect(j.generationMetadata.retried).toBe(false);
    expect(typeof j.generationMetadata.provider).toBe('string');
  });

  it('retried true when first content fails validation and second passes', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const badJson = invalidPlanJson('should be null');
    mockedChatDetailed
      .mockResolvedValueOnce({ content: badJson, usage: { input: 10, output: 10 }, finishReason: 'stop' })
      .mockResolvedValueOnce({ content: JSON.stringify(validLessonPlan), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { generationMetadata: { retried: boolean } }).generationMetadata.retried).toBe(true);
    expect(mockedChatDetailed).toHaveBeenCalledTimes(2);
    // second call received appended validation error mentioning reflections
    const secondCall = mockedChatDetailed.mock.calls.at(1);
    expect(secondCall).toBeDefined();
    expect(JSON.stringify(secondCall)).toContain('Previous output failed validation');
    expect(JSON.stringify(secondCall)).toContain('reflections');
  });

  it('502 with trimmed raw + validationErrors when both attempts fail', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    const badJson = invalidPlanJson('x');
    mockedChatDetailed
      .mockResolvedValueOnce({ content: badJson, usage: { input: 10, output: 10 }, finishReason: 'stop' })
      .mockResolvedValueOnce({ content: `${badJson}${'x'.repeat(10_000)}`, usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }),
    });
    expect(res.status).toBe(502);
    const j = (await res.json()) as { validationErrors: string; raw: string };
    expect(typeof j.validationErrors).toBe('string');
    expect(j.validationErrors.length).toBeGreaterThan(0);
    expect(typeof j.raw).toBe('string');
    expect(j.raw.length).toBeLessThanOrEqual(8192);
  });

  it('provider/model overrides are forwarded to chatDetailed', async () => {
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    mockedChatDetailed.mockResolvedValueOnce({ content: JSON.stringify(validLessonPlan), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1', provider: 'openrouter', model: 'test-model' }),
    });
    expect(res.status).toBe(200);
    expect(mockedChatDetailed).toHaveBeenCalled();
    const firstCall = mockedChatDetailed.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const opts = (firstCall as unknown[])[1] as { task?: string; model?: string };
    expect(opts.task).toBe('lesson_plan');
    expect(opts.model).toBe('test-model');
  });

  it('accepts opportunitiesForIntegration literal N/A', async () => {
    const na = JSON.parse(JSON.stringify(validLessonPlan));
    na.learningExperience.sessions[1].opportunitiesForIntegration = 'N/A';
    mockedExtractionCache.get.mockReturnValue(cachedExtraction());
    mockedChatDetailed.mockResolvedValueOnce({ content: JSON.stringify(na), usage: { input: 10, output: 10 }, finishReason: 'stop' });
    const res = await app().request('/api/lesson-plans/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extractionId: 'abc', termLabel: 'First Term', weekLabel: 'Week 1' }),
    });
    expect(res.status).toBe(200);
  });
});
