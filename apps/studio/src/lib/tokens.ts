export const TOKEN_ESTIMATE_FACTOR = 1.3;
export const TOKEN_BUDGET_RATIO = 0.8;
export const DEFAULT_CEILING = 32_768;

/**
 * Rough token estimate: characters times a conservative chars-per-token factor,
 * rounded up.
 */
export function estimateTokens(input: string): number {
  return Math.ceil(input.length * TOKEN_ESTIMATE_FACTOR);
}

/**
 * Output budget that never pushes input+output past the provider's window:
 * capped at the window budget minus the estimated prompt, and never above the
 * fixed per-task ceiling. Clamped to 1 so a tiny window can't produce 0.
 */
export function buildMaxCompletionTokens(
  window: number,
  prompt: string,
  ceiling: number = DEFAULT_CEILING
): number {
  const outputBudget = Math.floor(window * TOKEN_BUDGET_RATIO);
  return Math.min(ceiling, Math.max(1, outputBudget - estimateTokens(prompt)));
}
