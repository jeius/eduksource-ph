import { describe, expect, it } from 'vitest';
import { SlideDeckSpecSchema } from './slide-deck.js';

// Minimal-but-realistic valid fixture (one session, 7-phase structure condensed)
const validDeck = {
  title: 'Understanding Developmental Stages',
  sessions: [
    {
      sessionLabel: 'Session 1',
      slides: [
        { layout: 'title', heading: 'Understanding Developmental Stages', imagePrompt: null },
        {
          layout: 'objectives',
          heading: 'Learning Objectives',
          bullets: ['identify stages', 'describe characteristics', 'reflect on importance'],
          speakerNotes: 'Read objectives aloud and connect to previous session.',
        },
        {
          layout: 'content',
          heading: 'Key Developmental Tasks',
          bullets: ['task one', 'task two'],
          speakerNotes: 'Flow paragraph condensed: present timeline activity first.',
          imagePrompt: 'A labeled timeline of adolescent development stages',
        },
        {
          layout: 'closing',
          heading: 'Extend Your Learning',
          bullets: ['Family observation journal'],
        },
      ],
    },
  ],
};

describe('SlideDeckSpecSchema', () => {
  it('accepts a valid one-session deck across all layout kinds', () => {
    expect(() => SlideDeckSpecSchema.parse(validDeck)).not.toThrow();
  });

  it('rejects an unknown layout value with path containing layout', () => {
    const bad = structuredClone(validDeck);
    const objectivesSlide = bad.sessions[0]?.slides[1];
    if (!objectivesSlide) throw new Error('valid fixture missing objectives slide');
    objectivesSlide.layout = 'hype-slide';
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toContain('layout');
    }
  });

  it('rejects more than five bullets per slide', () => {
    const bad = structuredClone(validDeck);
    const objectivesSlide = bad.sessions[0]?.slides[1];
    if (!objectivesSlide) throw new Error('valid fixture missing objectives slide');
    objectivesSlide.bullets = ['1', '2', '3', '4', '5', '6'];
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('bullet');
    }
  });

  it('rejects a second session (decks are single-session by design)', () => {
    const bad = structuredClone(validDeck);
    bad.sessions.push({
      sessionLabel: 'Session 2',
      // imagePrompt: null matches the title-slide shape of the fixture union under strict TS.
      slides: [{ layout: 'title', heading: 'Second session deck', imagePrompt: null }],
    });
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('allows imagePrompt null on title slide and populated on content slide', () => {
    const result = SlideDeckSpecSchema.safeParse(validDeck);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions[0]?.slides[0]?.imagePrompt).toBeNull();
      expect(typeof result.data.sessions[0]?.slides[2]?.imagePrompt).toBe('string');
    }
  });

  it('requires heading on every slide', () => {
    const bad = structuredClone(validDeck);
    const titleSlide = bad.sessions[0]?.slides[0];
    if (!titleSlide) throw new Error('valid fixture missing title slide');
    delete (titleSlide as { heading?: string }).heading;
    const result = SlideDeckSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
