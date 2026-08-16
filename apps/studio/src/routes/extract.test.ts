import { honoLogLayer } from '@loglayer/hono';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../config/logger.js';
import type { BowDocument, ExtractResponse } from '../schemas/extract.js';

const { windowHolder } = vi.hoisted(() => ({ windowHolder: { value: 128_000 } }));

const { mockedNimChatDetailed, mockedNimVisionChat } = vi.hoisted(() => ({
  mockedNimChatDetailed: vi.fn(),
  mockedNimVisionChat: vi.fn(),
}));

const { mockedExtractText, mockedPdfPagesToPngs, mockedTooManyPagesError } = vi.hoisted(() => ({
  mockedExtractText: vi.fn(),
  mockedPdfPagesToPngs: vi.fn(),
  mockedTooManyPagesError: class TooManyPagesError extends Error {
    constructor(maxPages: number) {
      super(`Too many pages (max ${maxPages})`);
      this.name = 'TooManyPagesError';
    }
  },
}));

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    hashFile: vi.fn(),
  },
}));

vi.mock('../lib/nim.js', () => ({
  defaultModel: 'test-model',
  get defaultContextWindow() {
    return windowHolder.value;
  },
  nimChatDetailed: mockedNimChatDetailed,
  nimVisionChat: mockedNimVisionChat,
}));

vi.mock('../lib/pdf.js', () => ({
  extractText: mockedExtractText,
  pdfPagesToPngs: mockedPdfPagesToPngs,
  TooManyPagesError: mockedTooManyPagesError,
}));

vi.mock('../lib/cache.js', () => ({
  extractionCache: mockedExtractionCache,
}));

import { createExtractRoutes } from './extract.js';

const validDoc: BowDocument = {
  learningArea: 'English',
  gradeLevel: 'Grade 7',
  documentNotes: null,
  terms: [
    {
      termLabel: 'First Term',
      contentStandard: ['CS'],
      performanceStandard: ['PS'],
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
          strands: [{ strandLabel: null, topicLabel: 'Topic', competenciesRaw: '- Competency' }],
          extractionNotes: null,
        },
      ],
    },
  ],
};

function pdfForm(): FormData {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(1000)], { type: 'application/pdf' }),
    'test.pdf'
  );
  return formData;
}

function mockChatOk(overrides: Partial<BowDocument> = {}): void {
  mockedNimChatDetailed.mockResolvedValue({
    content: JSON.stringify({ ...validDoc, ...overrides }),
    usage: { input: 120, output: 45 },
  });
}

describe('POST /api/extract', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = new Hono();
    app.use(honoLogLayer({ instance: createSilentLogger() }));
    app.route('/api', createExtractRoutes());
    mockedExtractionCache.get.mockReturnValue(undefined);
    mockedExtractionCache.hashFile.mockResolvedValue('hash123');
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 });
  });

  afterEach(() => {
    windowHolder.value = 128_000;
    vi.resetAllMocks();
  });

  it('rejects non-PDF with 400', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['not pdf'], { type: 'text/plain' }), 'test.txt');
    const res = await app.request('/api/extract', { method: 'POST', body: formData });
    expect(res.status).toBe(400);
  });

  it('rejects oversized file with 413', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'application/pdf' }),
      'big.pdf'
    );
    const res = await app.request('/api/extract', { method: 'POST', body: formData });
    expect(res.status).toBe(413);
  });

  it('returns 413 for PDF with more than MAX_PAGES pages', async () => {
    mockedExtractText.mockResolvedValue({ text: 'test', pages: 21 });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(413);
  });

  it('uses vision fallback when unpdf returns short text', async () => {
    mockChatOk();
    mockedExtractText.mockResolvedValue({ text: 'short', pages: 1 });
    mockedPdfPagesToPngs.mockResolvedValue(['img1']);
    mockedNimVisionChat.mockResolvedValue('Extracted via vision');
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedPdfPagesToPngs).toHaveBeenCalledWith(expect.any(Uint8Array), 20);
    expect(mockedNimVisionChat).toHaveBeenCalledWith(['img1'], expect.any(String));
  });

  it('batches the OCR model call when many pages are rendered', async () => {
    mockChatOk();
    mockedExtractText.mockResolvedValue({ text: 'short', pages: 1 });
    // 6 page images => 2 batches of 5 (first 5, then the remainder)
    mockedPdfPagesToPngs.mockResolvedValue(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    mockedNimVisionChat.mockResolvedValueOnce('Page 1-5 text').mockResolvedValueOnce('Page 6 text');
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimVisionChat).toHaveBeenCalledTimes(2);
    expect(mockedNimVisionChat).toHaveBeenNthCalledWith(
      1,
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      expect.any(String)
    );
    expect(mockedNimVisionChat).toHaveBeenNthCalledWith(2, ['p6'], expect.any(String));
  });

  it('falls back to vision when unpdf throws', async () => {
    mockChatOk();
    mockedExtractText.mockRejectedValue(new Error('unpdf exploded'));
    mockedPdfPagesToPngs.mockResolvedValue(['img1']);
    mockedNimVisionChat.mockResolvedValue('OCR text from pages');
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimVisionChat).toHaveBeenCalled();
  });

  it('returns 413 when rendered PDF exceeds page limit', async () => {
    mockedExtractText.mockRejectedValue(new Error('x'));
    mockedPdfPagesToPngs.mockRejectedValue(new mockedTooManyPagesError(20));
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(413);
  });

  it('returns 500 when unpdf and vision both fail', async () => {
    mockedExtractText.mockRejectedValue(new Error('unpdf exploded'));
    mockedPdfPagesToPngs.mockRejectedValue(new Error('render failed'));
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(500);
  });

  it('returns a graceful empty document for an empty PDF', async () => {
    mockedExtractText.mockResolvedValue({ text: '', pages: 1 });
    mockedPdfPagesToPngs.mockResolvedValue([]);
    mockedNimVisionChat.mockResolvedValue('');
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms).toEqual([]);
    expect(mockedNimChatDetailed).not.toHaveBeenCalled();
  });

  it('retries once on JSON parse failure then succeeds', async () => {
    mockedNimChatDetailed
      .mockResolvedValueOnce({ content: 'invalid json {', usage: { input: 1, output: 1 } })
      .mockResolvedValueOnce({ content: JSON.stringify(validDoc), usage: { input: 2, output: 2 } });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(2);
  });

  it('returns 500 with raw output after retry still fails', async () => {
    mockedNimChatDetailed
      .mockResolvedValueOnce({ content: 'invalid json {', usage: { input: 1, output: 1 } })
      .mockResolvedValueOnce({ content: 'still invalid {', usage: { input: 1, output: 1 } });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.raw).toBe('still invalid {');
  });

  it('recovers from truncated output by extracting per term', async () => {
    mockedExtractText.mockResolvedValue({
      text: 'First Term ' + 'A'.repeat(200) + ' Second Term ' + 'B'.repeat(200),
      pages: 1,
    });
    // First (whole-doc) call truncates on the token limit — no retry; the route
    // must split by term and re-extract each section separately.
    mockedNimChatDetailed
      .mockResolvedValueOnce({
        content: '{"learningArea":"English","trunc',
        usage: { input: 100, output: 8192 },
        finishReason: 'length',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ ...validDoc, learningArea: 'English' }),
        usage: { input: 10, output: 5 },
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...validDoc,
          learningArea: '',
          terms: [{ ...validDoc.terms[0]!, termLabel: 'Second Term' }],
        }),
        usage: { input: 8, output: 4 },
        finishReason: 'stop',
      });

    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(3);
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms.map((t) => t.termLabel)).toEqual(['First Term', 'Second Term']);
    expect(body.document.learningArea).toBe('English');
  });

  it('returns 500 with raw output when a term section still truncates', async () => {
    mockedExtractText.mockResolvedValue({
      text: 'First Term ' + 'A'.repeat(200) + ' Second Term ' + 'B'.repeat(200),
      pages: 1,
    });
    mockedNimChatDetailed
      .mockResolvedValueOnce({
        content: '{"learningArea":"English","trunc',
        usage: { input: 100, output: 8192 },
        finishReason: 'length',
      })
      .mockResolvedValueOnce({
        content: '{"termLabel":"First","trunc',
        usage: { input: 5, output: 8192 },
        finishReason: 'length',
      });

    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.raw).toBe('{"termLabel":"First","trunc');
  });

  it('caches result and skips NIM on second upload', async () => {
    mockChatOk();
    const res1 = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res1.status).toBe(200);
    mockedExtractionCache.get.mockReturnValue({
      text: 'cached',
      pages: 1,
      document: validDoc,
      warnings: [],
      notes: [],
    });
    const res2 = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res2.status).toBe(200);
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(1);
  });

  it('splits by term when text exceeds the token budget', async () => {
    mockedExtractText.mockResolvedValue({
      text: 'First Term ' + 'A'.repeat(40_000) + ' Second Term ' + 'B'.repeat(40_000),
      pages: 1,
    });
    mockedNimChatDetailed
      .mockResolvedValueOnce({
        content: JSON.stringify({ ...validDoc, learningArea: 'Math', terms: [validDoc.terms[0]] }),
        usage: { input: 100, output: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...validDoc,
          learningArea: '',
          terms: [{ ...validDoc.terms[0], termLabel: 'Second Term' }],
        }),
        usage: { input: 90, output: 8 },
      });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms.map((t) => t.termLabel)).toEqual(['First Term', 'Second Term']);
    expect(body.document.learningArea).toBe('Math');
  });

  it('splits by term when the provider context window is small', async () => {
    windowHolder.value = 1_000;
    mockedExtractText.mockResolvedValue({
      text: 'First Term ' + 'A'.repeat(400) + ' Second Term ' + 'B'.repeat(400),
      pages: 1,
    });
    mockedNimChatDetailed
      .mockResolvedValueOnce({
        content: JSON.stringify({ ...validDoc, terms: [validDoc.terms[0]] }),
        usage: { input: 10, output: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...validDoc,
          learningArea: '',
          terms: [{ ...validDoc.terms[0], termLabel: 'Second Term' }],
        }),
        usage: { input: 8, output: 4 },
      });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    expect(mockedNimChatDetailed).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms.map((t) => t.termLabel)).toEqual(['First Term', 'Second Term']);
  });

  it('omits invalid blocks and returns valid blocks plus a warning', async () => {
    const badBlock = {
      weekLabel: '2',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [], // violates min(1)
      extractionNotes: null,
    };
    const validBlocks = Array.from({ length: 9 }, () => validDoc.terms[0]!.blocks[0]!);
    mockedNimChatDetailed.mockResolvedValue({
      content: JSON.stringify({
        ...validDoc,
        terms: [{ ...validDoc.terms[0]!, blocks: [...validBlocks, badBlock] }],
      }),
      usage: { input: 120, output: 45 },
    });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExtractResponse;
    expect(body.document.terms[0]!.blocks).toHaveLength(9);
    expect(body.warnings.join(' ')).toContain('1 competency blocks omitted');
  });

  it('returns 500 when most blocks fail validation', async () => {
    const badBlock = {
      weekLabel: '2',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [], // violates min(1)
      extractionNotes: null,
    };
    mockedNimChatDetailed.mockResolvedValue({
      content: JSON.stringify({
        ...validDoc,
        terms: [
          {
            ...validDoc.terms[0]!,
            blocks: [
              validDoc.terms[0]!.blocks[0]!,
              badBlock,
              { ...badBlock, weekLabel: '3' },
              { ...badBlock, weekLabel: '4' },
              { ...badBlock, weekLabel: '5' },
            ],
          },
        ],
      }),
      usage: { input: 120, output: 45 },
    });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; omitted: number };
    expect(body.error).toContain('failed validation');
    expect(body.omitted).toBe(4);
    expect(mockedExtractionCache.set).not.toHaveBeenCalled();
  });

  it('aggregates extractionNotes from blocks into the notes array', async () => {
    mockedNimChatDetailed.mockResolvedValue({
      content: JSON.stringify({
        ...validDoc,
        terms: [
          {
            ...validDoc.terms[0],
            blocks: [
              {
                ...validDoc.terms[0]!.blocks[0]!,
                extractionNotes: 'Run-together artifact at "sentencehere"',
              },
            ],
          },
        ],
      }),
      usage: { input: 120, output: 45 },
    });
    const res = await app.request('/api/extract', { method: 'POST', body: pdfForm() });
    const body = (await res.json()) as ExtractResponse;
    expect(body.notes).toContain('Run-together artifact at "sentencehere"');
  });
});
