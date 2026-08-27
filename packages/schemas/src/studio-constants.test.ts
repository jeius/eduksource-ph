import { describe, expect, it } from 'vitest';
import { TEACHER_FILL_BLANK, TEACHER_FILL_NOTE } from './studio-constants.js';

describe('studio constants', () => {
  it('exposes non-empty fill blank used by DOCX/PPTX for missing teacher fields', () => {
    expect(TEACHER_FILL_BLANK.length).toBeGreaterThan(0);
    expect(TEACHER_FILL_BLANK).toContain('＿');
  });

  it('exposes non-empty fill note describing post-session completion', () => {
    expect(TEACHER_FILL_NOTE.length).toBeGreaterThan(0);
    expect(TEACHER_FILL_NOTE.toLowerCase()).toContain('teacher');
  });
});
