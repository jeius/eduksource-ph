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
