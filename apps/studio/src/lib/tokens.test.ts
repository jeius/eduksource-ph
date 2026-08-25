import { describe, expect, it } from 'vitest';
import { buildMaxCompletionTokens, estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('rounds up length * 1.3', () => {
    expect(estimateTokens('a'.repeat(10))).toBe(13);
    expect(estimateTokens('ab')).toBe(3); // ceil(2.6)
  });

  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildMaxCompletionTokens', () => {
  it('caps at the ceiling when the budget exceeds it', () => {
    // window 100_000 → floor(80_000) - small prompt ≫ 32_768
    expect(buildMaxCompletionTokens(100_000, 'hi')).toBe(32_768);
  });

  it('never returns below 1 and subtracts the prompt estimate', () => {
    // window 1 → floor(0.8) = 0, minus estimate ≥ 0 → clamped to 1
    expect(buildMaxCompletionTokens(1, '')).toBe(1);
    // window 100 → floor(80) - estimateTokens('abc')=ceil(3.9)=4 → 76
    expect(buildMaxCompletionTokens(100, 'abc')).toBe(76);
  });
});
