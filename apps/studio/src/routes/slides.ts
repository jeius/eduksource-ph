import { LessonPlanResponseSchema } from '@eduksource/schemas/lesson-plan.js';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { primaryContextWindow } from '../lib/ai/providers.js';
import { extractionCache } from '../lib/cache.js';
import type { SelectedSession } from '../lib/slides.js';
import { buildSlidePrompts, SessionNotFoundError, selectSession } from '../lib/slides.js';
import { buildMaxCompletionTokens, estimateTokens } from '../lib/tokens.js';
import type { HonoSchema } from '../lib/types.js';
import type { ExtractResponse } from '../schemas/extract.js';

export const GenerateSlidesRequestSchema = z.object({
  lessonPlan: LessonPlanResponseSchema,
  extractionId: z.string().min(1),
  termLabel: z.string().min(1),
  weekLabel: z.string().min(1),
  sessionLabel: z.string().min(1).optional(),
  systemFields: z
    .object({
      teacherName: z.string().min(1).nullable().optional(),
      sectionLabel: z.string().min(1).nullable().optional(),
      bowReference: z.string().min(1).optional(),
    })
    .optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
});

export function createSlidesRoutes() {
  const app = new Hono<HonoSchema>();

  app.post(
    '/generate',
    zValidator('json', GenerateSlidesRequestSchema, (result, c) => {
      if (!result.success) {
        // Plan's integration contract: invalid lessonPlan → 400 'Invalid lesson plan…'.
        return c.json({ error: 'Invalid lesson plan — schema validation failed' }, 400);
      }
      return undefined;
    }),
    async (c) => {
      const body = c.req.valid('json');

      // 410 — extraction gone from cache
      const cached = extractionCache.get(body.extractionId);
      if (!cached) {
        return c.json(
          {
            error: 'Extraction expired — re-upload the BOW and re-run /api/extract',
            code: 'EXTRACTION_EXPIRED',
          },
          410
        );
      }

      const extractionDoc: ExtractResponse['document'] = cached.document;

      // Phase 1: warn-only token check (parity with lesson-plan route).
      if (!c.req.header('x-internal-token')) {
        c.var.logger
          .withMetadata({ route: 'slides' })
          .warn('x-internal-token absent — allowed in Phase 1, will be required Phase 2');
      }

      // Session selection (default: first session)
      let selected: SelectedSession;
      try {
        selected = selectSession(body.lessonPlan, body.sessionLabel);
      } catch (err) {
        if (err instanceof SessionNotFoundError) {
          return c.json({ error: err.message, availableSessions: err.availableSessions }, 404);
        }
        throw err;
      }

      const { systemPrompt, userPrompt } = buildSlidePrompts(selected, body.lessonPlan.meta, {
        learningArea: extractionDoc.learningArea,
        gradeLevel: extractionDoc.gradeLevel,
      });

      const promptForBudget = systemPrompt + userPrompt;
      // TODO(ADR-0008): extractionId is currently a fileHash alias; migrate to
      // normalized-text hash (BOW text → sha256) and a durable api-owned row.

      if (body.dryRun) {
        return c.json({
          systemPrompt,
          userPrompt,
          estimatedTokens: estimateTokens(promptForBudget),
          maxCompletionTokens: buildMaxCompletionTokens(primaryContextWindow, promptForBudget),
          provider: body.provider ?? 'default',
          model: body.model ?? 'default',
        });
      }

      // Non-dryRun wiring lands in Task 5.
      return c.json({ error: 'Not implemented — full generation wired in next task' }, 501);
    }
  );

  return app;
}
