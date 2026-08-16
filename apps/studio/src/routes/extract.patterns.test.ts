import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { honoLogLayer } from '@loglayer/hono';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../config/logger.js';
import type { ExtractResponse } from '../schemas/extract.js';

const { mockedChatDetailed } = vi.hoisted(() => ({
  mockedChatDetailed: vi.fn(),
}));

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: { get: vi.fn(), set: vi.fn(), hashFile: vi.fn() },
}));

vi.mock('../lib/ai/client.js', () => ({
  chatDetailed: mockedChatDetailed,
  visionChat: vi.fn().mockResolvedValue(''),
}));

vi.mock('../lib/ai/providers.js', () => ({
  primaryContextWindow: 128_000,
}));

vi.mock('../lib/cache.js', () => ({
  extractionCache: mockedExtractionCache,
}));

// NOTE: lib/pdf.js is intentionally NOT mocked — real unpdf extraction runs on real fixtures.

import { createExtractRoutes } from './extract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = (name: string) => join(__dirname, '..', '..', 'tests', 'fixtures', name);

async function postFixture(app: Hono, name: string): Promise<Response> {
  const bytes = await readFile(fixturePath(name));
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    'bow.pdf'
  );
  return app.request('/api/extract', { method: 'POST', body: formData });
}

function mockDoc(overrides: Partial<ExtractResponse['document']> = {}): void {
  mockedChatDetailed.mockResolvedValue({
    content: JSON.stringify({
      learningArea: 'Subject',
      gradeLevel: 'Grade 7',
      documentNotes: null,
      terms: [],
      ...overrides,
    }),
    usage: { input: 120, output: 45 },
  });
}

describe('POST /api/extract — structural patterns', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = new Hono();
    app.use(honoLogLayer({ instance: createSilentLogger() }));
    app.route('/api', createExtractRoutes());
    mockedExtractionCache.get.mockReturnValue(undefined);
    mockedExtractionCache.hashFile.mockResolvedValue('hash-fixture');
    mockDoc();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('extracts real text from the English fixture and passes it to NIM', async () => {
    await postFixture(app, 'BOW-[G7]-English.pdf');
    expect(mockedChatDetailed).toHaveBeenCalledTimes(1);
    const call = mockedChatDetailed.mock.calls[0]![0]! as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = call.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('First Term');
  });

  it('preserves week "*" verbatim (English fixture)', async () => {
    mockDoc({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: ['CS'],
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '*',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, 'BOW-[G7]-English.pdf');
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms[0]!.blocks[0]!.weekLabel).toBe('*');
  });

  it('keeps per-block content standard and skillsFocus gloss (Values Education fixture)', async () => {
    mockDoc({
      learningArea: 'Values Education',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: ['Block-level CS'],
              performanceStandard: ['Block-level PS'],
              skillsFocus: {
                sourceLabel: 'Values to be Developed',
                items: [{ text: 'Honesty', gloss: 'paglalahad ng katotohanan' }],
              },
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, 'BOW-[G10]-Values Education-Three-Term.pdf');
    const body = (await res.json()) as ExtractResponse;
    const block = body.document.terms[0]!.blocks[0]!;
    expect(body.document.terms[0]!.contentStandard).toBeNull();
    expect(block.contentStandard).toEqual(['Block-level CS']);
    expect(block.skillsFocus?.sourceLabel).toBe('Values to be Developed');
    expect(block.skillsFocus?.items).toHaveLength(1);
    expect(block.skillsFocus?.items[0]?.gloss).not.toBeNull();
  });

  it('captures two labeled strands in one block plus documentNotes (MAPEH fixture)', async () => {
    mockDoc({
      learningArea: 'MAPEH',
      documentNotes: '2 hours per week total',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [
                { strandLabel: 'Music and Arts', topicLabel: null, competenciesRaw: '- sing' },
                { strandLabel: 'PE and Health', topicLabel: null, competenciesRaw: '- run' },
              ],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G9] MAPEH.pdf');
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.documentNotes).toBe('2 hours per week total');
    expect(body.document.terms[0]!.blocks[0]!.strands.map((s) => s.strandLabel)).toEqual([
      'Music and Arts',
      'PE and Health',
    ]);
  });

  it('keeps range week with durationDays and two strands (Mathematics fixture)', async () => {
    mockDoc({
      learningArea: 'General Mathematics',
      gradeLevel: 'Grade 11',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1 to 2 (10 days)',
              durationDays: 10,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [
                { strandLabel: 'Geometry', topicLabel: null, competenciesRaw: '- circles' },
                { strandLabel: 'Algebra', topicLabel: null, competenciesRaw: '- equations' },
              ],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G9] Mathematics.pdf');
    const body = (await res.json()) as ExtractResponse;
    const block = body.document.terms[0]!.blocks[0]!;
    expect(block.weekLabel).toBe('1 to 2 (10 days)');
    expect(block.durationDays).toBe(10);
    expect(block.strands.map((s) => s.strandLabel)).toEqual(['Geometry', 'Algebra']);
    expect(body.document.learningArea).toBe('General Mathematics');
  });

  it('captures multi-entry standards and term-level activity lists (Science fixture)', async () => {
    mockDoc({
      learningArea: 'Science',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: ['Standard A', 'Standard B'],
          performanceStandard: ['Performance A', 'Performance B'],
          skillsFocus: null,
          suggestedActivities: ['Activity 1', 'Activity 2'],
          suggestedPerformanceTasks: ['Task 1'],
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G4] Science.pdf');
    const body = (await res.json()) as ExtractResponse;
    const term = body.document.terms[0]!;
    expect(term.contentStandard).toEqual(['Standard A', 'Standard B']);
    expect(term.suggestedActivities).toEqual(['Activity 1', 'Activity 2']);
    expect(term.suggestedPerformanceTasks).toEqual(['Task 1']);
  });

  it('preserves deep nesting and plain-list skillsFocus (Life and Career Skills fixture)', async () => {
    const deeplyNested = [
      '- Level 1',
      '  - Level 2',
      '    - Level 3',
      '      - Level 4',
      '        - Level 5',
    ].join('\n');
    mockDoc({
      learningArea: 'Life and Career Skills',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: {
            sourceLabel: 'Essential Life Skills',
            items: [
              { text: 'Critical thinking', gloss: null },
              { text: 'Collaboration', gloss: null },
            ],
          },
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: deeplyNested }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G11] Life and Career Skills.pdf');
    const body = (await res.json()) as ExtractResponse;
    const term = body.document.terms[0]!;
    const raw = term.blocks[0]!.strands[0]!.competenciesRaw;
    expect(raw).toContain('Level 5');
    expect((raw.match(/^ {2}/gm) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(term.skillsFocus?.items).toHaveLength(2);
    expect(term.skillsFocus?.items.every((i) => i.gloss === null)).toBe(true);
  });

  it('maps Filipino labels and preserves them verbatim (Araling Panlipunan fixture)', async () => {
    mockDoc({
      learningArea: 'Araling Panlipunan',
      gradeLevel: 'Baitang 8',
      terms: [
        {
          termLabel: 'Unang Termino',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: 'Linggo 1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- Kasanayan' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G11] Pag-aaral ng Kasaysayan at Lipunang Pilipino.pdf');
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms[0]!.termLabel).toBe('Unang Termino');
    expect(body.document.terms[0]!.blocks[0]!.weekLabel).toBe('Linggo 1');

    const systemMsg = (
      mockedChatDetailed.mock.calls[0]![0]! as Array<{ role: string; content: string }>
    ).find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Kasanayang Pampagkatuto');
    // Whitespace-independent per-token asserts (the mapping phrase wraps across
    // lines in the prompt template) — robust against line-wrap changes AND a
    // rewrite that drops the mapping entirely.
    for (const token of ['Unang', 'Ikalawang', 'Ikatlong', 'Termino', 'Baitang']) {
      expect(systemMsg?.content).toContain(token);
    }
  });

  it('real unpdf extraction runs end-to-end on the Values Education fixture', async () => {
    mockDoc({
      learningArea: 'Values Education',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, 'BOW-[G10]-Values Education-Three-Term.pdf');
    expect(res.status).toBe(200);
    const call = mockedChatDetailed.mock.calls[0]![0]! as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = call.find((m) => m.role === 'user');
    expect(userMsg?.content.length).toBeGreaterThan(100);
  });

  it('real unpdf extraction runs end-to-end on the Filipino fixture', async () => {
    mockDoc({
      learningArea: 'Filipino',
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: null,
          performanceStandard: null,
          skillsFocus: null,
          suggestedActivities: null,
          suggestedPerformanceTasks: null,
          blocks: [
            {
              weekLabel: '1',
              durationDays: null,
              contentStandard: null,
              performanceStandard: null,
              skillsFocus: null,
              strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
              extractionNotes: null,
            },
          ],
        },
      ],
    });
    const res = await postFixture(app, '[G11] Filipino.pdf');
    expect(res.status).toBe(200);
    const call = mockedChatDetailed.mock.calls[0]![0]! as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = call.find((m) => m.role === 'user');
    expect(userMsg?.content.length).toBeGreaterThan(100);
  });
});
