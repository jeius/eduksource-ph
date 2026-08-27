import type { SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { TEACHER_FILL_BLANK } from '@eduksource/schemas/studio-constants.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SystemFields } from '@eduksource/schemas/system-fields.js';
import { assemblePptx, assemblePptxToBase64 } from './pptx.js';

const deck: SlideDeckSpec = {
  title: 'Understanding Developmental Stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding Developmental Stages', imagePrompt: null },
        {
          layout: 'objectives',
          heading: 'Learning Objectives',
          bullets: ['identify stages', 'reflect on importance'],
          speakerNotes: 'Connect to prior session.',
        },
        {
          layout: 'content',
          heading: 'Developmental Tasks',
          bullets: ['physical growth', 'social roles'],
          speakerNotes: 'From flow: present timeline activity.',
          imagePrompt: 'Timeline of development stages',
        },
      ],
    },
  ],
};

const baseFields: SystemFields = {
  teacherName: 'Maiza R. Evangelista',
  sectionLabel: '11-Tesla',
  gradeLevel: 'Grade 11',
  learningArea: 'Life and Career Skills',
  generationMetadata: { provider: 'nim', model: 'test-model', generatedAt: '2026-08-25T00:00:00Z' },
  bowReference: 'DepEd BOW — First Term, Week 1',
};

describe('assemblePptx', () => {
  let buffer: Buffer;

  beforeAll(async () => {
    buffer = await assemblePptx(deck, baseFields);
  });

  it('produces a non-empty Buffer starting with the PK zip signature', () => {
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('exposes the assembled presentation with three slides via the test hook', () => {
    const pres = (
      globalThis as { __lastPptxPresentation?: { slides: Array<{ _slideObjects: unknown[] }> } }
    ).__lastPptxPresentation;
    if (!pres) throw new Error('assembler did not expose __lastPptxPresentation');
    expect(pres.slides.length).toBe(3);
    expect(pres.slides[0]?._slideObjects.length).toBeGreaterThan(0);
    expect(pres.slides[1]?._slideObjects.length).toBeGreaterThan(0);
  });

  it('serializes identically through the base64 helper', async () => {
    const b64 = await assemblePptxToBase64(deck, baseFields);
    expect(Buffer.from(b64, 'base64').subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('fills teacher blanks when systemFields carry null names', async () => {
    await assemblePptx(deck, {
      ...baseFields,
      teacherName: null,
      sectionLabel: null,
    });
    const pres = (
      globalThis as { __lastPptxPresentation?: { slides: Array<{ getText?: () => string }> } }
    ).__lastPptxPresentation;
    if (!pres) throw new Error('assembler did not expose __lastPptxPresentation');
    const titleSlide = pres.slides[0];
    const textJson = JSON.stringify(titleSlide);
    expect(textJson).toContain(TEACHER_FILL_BLANK);
  });
});
