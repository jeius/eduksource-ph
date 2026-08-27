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

import { createDocxRoutes } from './docx.js';

function app() {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('logger' as never, createSilentLogger());
    await next();
  });
  a.route('/api/docx', createDocxRoutes());
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
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedExtractionCache.get.mockReturnValue(cachedExtraction());
});
afterEach(() => {
  windowHolder.value = 128_000;
});

describe('POST /api/docx/generate', () => {
  it('410 EXTRACTION_EXPIRED when extractionId misses cache', async () => {
    mockedExtractionCache.get.mockReturnValue(undefined);
    const res = await app().request('/api/docx/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code?: string }).code).toBe('EXTRACTION_EXPIRED');
  });

  it('400 when lessonPlan fails schema validation', async () => {
    const bad = structuredClone(validLessonPlan) as typeof validLessonPlan & {
      waysForward: { sessions: Array<{ reflections: unknown }> };
    };
    const first = bad.waysForward.sessions[0];
    if (!first) throw new Error('fixture missing session');
    (first as { reflections: unknown }).reflections = 'not null';
    const res = await app().request('/api/docx/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ lessonPlan: bad })),
    });
    expect(res.status).toBe(400);
  });

  it('happy path returns binary DOCX with headers', async () => {
    const res = await app().request('/api/docx/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        requestBody({
          systemFields: {
            teacherName: 'Maiza R. Evangelista',
            generationMetadata: { provider: 'nim', model: 'gpt-x' },
          },
        })
      ),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('lesson-plan.docx');
    expect(res.headers.get('x-generated-at')).toBeTruthy();
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('declaration renders template when generationMetadata supplied', async () => {
    const res = await app().request('/api/docx/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        requestBody({
          systemFields: { generationMetadata: { provider: 'nim', model: 'gpt-x' } },
        })
      ),
    });
    expect(res.status).toBe(200);
    const xml = await extractDocumentXml(Buffer.from(await res.arrayBuffer()));
    expect(xml).toContain('gpt-x via nim');
  });

  it('declaration renders fallback text when generationMetadata absent', async () => {
    const res = await app().request('/api/docx/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(res.status).toBe(200);
    const xml = await extractDocumentXml(Buffer.from(await res.arrayBuffer()));
    expect(xml).toContain('docx-assembly via assembly');
  });
});

/** Extract word/document.xml from a docx zip buffer. */
async function extractDocumentXml(buf: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');
  const u8 = new Uint8Array(buf);
  let start = 0;
  while (start < u8.length - 30) {
    const sig =
      u8[start] === 0x50 &&
      u8[start + 1] === 0x4b &&
      u8[start + 2] === 0x03 &&
      u8[start + 3] === 0x04;
    if (!sig) {
      start += 1;
      continue;
    }
    const i = start;
    const method = u8[i + 8] ?? 0;
    const compSize =
      (u8[i + 18] ?? 0) |
      ((u8[i + 19] ?? 0) << 8) |
      ((u8[i + 20] ?? 0) << 16) |
      ((u8[i + 21] ?? 0) << 24);
    const nameLen = (u8[i + 26] ?? 0) | ((u8[i + 27] ?? 0) << 8);
    const extraLen = (u8[i + 28] ?? 0) | ((u8[i + 29] ?? 0) << 8);
    const nameStart = i + 30;
    const thisName = Buffer.from(u8.slice(nameStart, nameStart + nameLen)).toString('utf8');
    if (thisName === 'word/document.xml') {
      const dataStart = nameStart + nameLen + extraLen;
      const raw = u8.slice(dataStart, dataStart + compSize);
      return method === 0
        ? Buffer.from(raw).toString('utf8')
        : inflateRawSync(raw).toString('utf8');
    }
    start = nameStart + nameLen + extraLen + (compSize > 0 ? compSize : 1);
  }
  throw new Error('word/document.xml not found');
}
