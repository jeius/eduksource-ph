import { z } from 'zod';

/**
 * Shared SlideDeckSpec contract — the intermediate representation between
 * LessonPlanResponse generation and PPTX assembly (ADR-0006, assembly spec §5).
 *
 * One session per deck by design (teachers reuse the same deck across a
 * week-block's sessions). Bullets cap at 5 to hold the ~30% text / ~70%
 * visual-space rule. imagePrompt is populated by generation for Phase 2
 * image rendering but ignored by the Phase 1 assembler.
 */

export const SlideLayoutSchema = z.enum([
  'title',
  'objectives',
  'motivation',
  'content',
  'activity',
  'checkForUnderstanding',
  'closing',
]);

export const SlideSchema = z.object({
  layout: SlideLayoutSchema,
  heading: z.string().min(1),
  bullets: z.array(z.string().min(1)).max(5).optional(),
  /** Teacher guidance while presenting — drawn from the LP flow, never shown on the slide face (ADR-0006). */
  speakerNotes: z.string().min(1).optional(),
  /** Visual description for Phase 2 image rendering; null where no imagery is wanted. */
  imagePrompt: z.string().min(1).nullable().optional(),
});

export const SlideSessionSchema = z.object({
  sessionLabel: z.string().min(1),
  slides: z.array(SlideSchema).min(1),
});

export const SlideDeckSpecSchema = z.object({
  title: z.string().min(1),
  // Exactly one session per deck (grilling Q7/Q11 — teachers reuse one deck across the block).
  sessions: z.array(SlideSessionSchema).length(1),
});

export type SlideLayout = z.infer<typeof SlideLayoutSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type SlideSession = z.infer<typeof SlideSessionSchema>;
export type SlideDeckSpec = z.infer<typeof SlideDeckSpecSchema>;
