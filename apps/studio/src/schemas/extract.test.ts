import { describe, expect, it } from 'vitest';
import {
  type BowBlock,
  BowBlockSchema,
  type BowDocument,
  BowDocumentSchema,
  type BowStrand,
  type BowTerm,
  BowTermSchema,
  type ExtractResponse,
  ExtractResponseSchema,
  LooseBowBlockSchema,
  SkillsFocusSchema,
} from './extract.js';

describe('extract v3 schemas', () => {
  const validDocument = {
    learningArea: 'General Mathematics',
    gradeLevel: 'Grade 11',
    documentNotes: '2 hours per week',
    terms: [
      {
        termLabel: 'First Term',
        contentStandard: ['CS 1', 'CS 2'],
        performanceStandard: ['PS 1'],
        skillsFocus: {
          sourceLabel: 'Essential Life Skills',
          items: [{ text: 'Critical thinking', gloss: null }],
        },
        suggestedActivities: ['Activity 1'],
        suggestedPerformanceTasks: null,
        blocks: [
          {
            weekLabel: '1 to 2 (10 days)',
            durationDays: 10,
            contentStandard: ['Block CS'],
            performanceStandard: null,
            skillsFocus: null,
            strands: [
              {
                strandLabel: 'Geometry',
                topicLabel: 'Circles',
                competenciesRaw: '- Draw\n  - Label',
              },
              { strandLabel: 'Algebra', topicLabel: null, competenciesRaw: '- Solve' },
            ],
            extractionNotes: null,
          },
        ],
      },
    ],
  };

  it('parses a full valid BowDocument', () => {
    expect(BowDocumentSchema.parse(validDocument)).toEqual(validDocument);
  });

  it('preserves week "*" and range labels verbatim with durationDays', () => {
    const block = BowBlockSchema.parse({
      weekLabel: '*',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    });
    expect(block.weekLabel).toBe('*');
    const range = BowBlockSchema.parse({
      weekLabel: '1 to 2 (10 days)',
      durationDays: 10,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    });
    expect(range.weekLabel).toBe('1 to 2 (10 days)');
    expect(range.durationDays).toBe(10);
  });

  it('captures multiple content standard entries as separate array items', () => {
    const doc = BowDocumentSchema.parse(validDocument);
    expect(doc.terms[0]!.contentStandard).toEqual(['CS 1', 'CS 2']);
  });

  it('keeps per-block content standard on the block, term-level stays null', () => {
    const block = BowBlockSchema.parse({
      weekLabel: '1',
      durationDays: null,
      contentStandard: ['Block CS'],
      performanceStandard: null,
      skillsFocus: null,
      strands: [{ strandLabel: null, topicLabel: null, competenciesRaw: '- x' }],
      extractionNotes: null,
    });
    expect(block.contentStandard).toEqual(['Block CS']);
    const term = BowTermSchema.parse({
      termLabel: 'First Term',
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: null,
      blocks: [block],
      suggestedActivities: null,
      suggestedPerformanceTasks: null,
    });
    expect(term.contentStandard).toBeNull();
  });

  it('supports skillsFocus with gloss and as plain list', () => {
    expect(BowDocumentSchema.parse({ ...validDocument, terms: [] })).toBeTruthy();
    const focus = validDocument.terms[0]!.skillsFocus;
    expect(focus.items[0]!.gloss).toBeNull();
    expect(focus.sourceLabel).toBe('Essential Life Skills');
  });

  it('captures a multi-item skillsFocus plain list with gloss null', () => {
    const focus = SkillsFocusSchema.parse({
      sourceLabel: 'Essential Life Skills',
      items: [
        { text: 'Critical thinking', gloss: null },
        { text: 'Collaboration', gloss: null },
      ],
    });
    expect(focus.items).toHaveLength(2);
    expect(focus.items.every((item) => item.gloss === null)).toBe(true);
  });

  it('captures skillsFocus with a parenthetical gloss', () => {
    const focus = SkillsFocusSchema.parse({
      sourceLabel: 'Values to be Developed',
      items: [{ text: 'Honesty', gloss: 'paglalahad ng katotohanan' }],
    });
    expect(focus.items[0]!.gloss).toBe('paglalahad ng katotohanan');
  });

  it('rejects skillsFocus with zero items', () => {
    expect(() =>
      SkillsFocusSchema.parse({ sourceLabel: 'Values to be Developed', items: [] })
    ).toThrow();
  });

  it('allows two strands in a single block', () => {
    const doc = BowDocumentSchema.parse(validDocument);
    expect(doc.terms[0]!.blocks[0]!.strands).toHaveLength(2);
  });

  it('rejects a block with zero strands', () => {
    expect(() =>
      BowBlockSchema.parse({
        weekLabel: '1',
        durationDays: null,
        contentStandard: null,
        performanceStandard: null,
        skillsFocus: null,
        strands: [],
        extractionNotes: null,
      })
    ).toThrow();
  });

  it('loose block schema accepts what strict rejects (salvage boundary)', () => {
    const salvageBoundary = {
      weekLabel: '1',
      durationDays: null,
      contentStandard: null,
      performanceStandard: null,
      skillsFocus: { sourceLabel: 'X', items: [] },
      strands: [],
      extractionNotes: null,
    };
    expect(LooseBowBlockSchema.parse(salvageBoundary)).toEqual(salvageBoundary);
    expect(() => BowBlockSchema.parse(salvageBoundary)).toThrow();
  });

  it('rejects a document missing required fields', () => {
    expect(() => ExtractResponseSchema.parse({ text: 'x', pages: 1 })).toThrow();
    expect(() => BowDocumentSchema.parse({})).toThrow();
  });

  it('infers v3 types', () => {
    const response: ExtractResponse = {
      text: 'x',
      pages: 1,
      document: validDocument,
      warnings: [],
      notes: [],
    };
    expect(response.document.terms[0]!.blocks[0]!.strands[0]!.strandLabel).toBe('Geometry');
    const block: BowBlock = response.document.terms[0]!.blocks[0]!;
    const strand: BowStrand = block.strands[0]!;
    const term: BowTerm = response.document.terms[0]!;
    const doc: BowDocument = response.document;
    expect(strand.competenciesRaw).toContain('Label');
    expect(term.termLabel).toBe('First Term');
    expect(doc.learningArea).toBe('General Mathematics');
  });
});
