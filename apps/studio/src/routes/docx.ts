import { LessonPlanResponseSchema } from '@eduksource/schemas/lesson-plan.js';
import type { SystemFields } from '@eduksource/schemas/system-fields.js';
import { SystemFieldsSchema } from '@eduksource/schemas/system-fields.js';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { extractionCache } from '../lib/cache.js';
import { assembleDocx } from '../lib/docx.js';
import type { HonoSchema } from '../lib/types.js';
import type { ExtractResponse } from '../schemas/extract.js';

/**
 * POST /api/docx/generate — pure deterministic DOCX assembly from a reviewed
 * LessonPlanResponse (assembly spec §4, §6 step 4). Zero AI calls: no dryRun,
 * no session selection, no provider/model overrides. The route reads the
 * extraction only for gradeLevel/learningArea system fields (ADR-0006 holds:
 * content comes from the lesson plan, not the BOW).
 */

const GenerateDocxRequestSchema = z.object({
  lessonPlan: LessonPlanResponseSchema,
  extractionId: z.string().min(1),
  termLabel: z.string().min(1),
  weekLabel: z.string().min(1),
  systemFields: z
    .object({
      teacherName: z.string().min(1).nullable().optional(),
      sectionLabel: z.string().min(1).nullable().optional(),
      bowReference: z.string().min(1).optional(),
      preparedBy: z.string().min(1).nullable().optional(),
      checkedBy: z.string().min(1).nullable().optional(),
      notedBy: z.string().min(1).nullable().optional(),
      checkedByRole: z.string().min(1).optional(),
      notedByRole: z.string().min(1).optional(),
      letterhead: z
        .object({ lines: z.array(z.string().min(1)).min(1) })
        .nullable()
        .optional(),
      generationMetadata: z
        .object({
          provider: z.string().min(1).optional(),
          model: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
});

export function resolveSystemFields(
  body: z.infer<typeof GenerateDocxRequestSchema>,
  extractionDoc: ExtractResponse['document']
): SystemFields {
  const sf = body.systemFields;
  const parsed = SystemFieldsSchema.parse({
    teacherName: sf?.teacherName ?? null,
    sectionLabel: sf?.sectionLabel ?? null,
    gradeLevel: extractionDoc.gradeLevel,
    learningArea: extractionDoc.learningArea,
    generationMetadata: {
      provider: sf?.generationMetadata?.provider ?? 'assembly',
      model: sf?.generationMetadata?.model ?? 'docx-assembly',
      generatedAt: new Date().toISOString(),
    },
    bowReference: sf?.bowReference ?? `DepEd BOW — ${body.termLabel}, ${body.weekLabel}`,
    ...(sf?.preparedBy !== undefined ? { preparedBy: sf.preparedBy } : {}),
    ...(sf?.checkedBy !== undefined ? { checkedBy: sf.checkedBy } : {}),
    ...(sf?.notedBy !== undefined ? { notedBy: sf.notedBy } : {}),
    ...(sf?.checkedByRole !== undefined ? { checkedByRole: sf.checkedByRole } : {}),
    ...(sf?.notedByRole !== undefined ? { notedByRole: sf.notedByRole } : {}),
    ...(sf?.letterhead !== undefined ? { letterhead: sf.letterhead } : {}),
  });
  return parsed;
}

export function createDocxRoutes() {
  const app = new Hono<HonoSchema>();

  app.post('/generate', zValidator('json', GenerateDocxRequestSchema), async (c) => {
    const body = c.req.valid('json');

    // 410 — extraction gone from cache (still needed for gradeLevel/learningArea).
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

    // Phase 1: warn-only token check (parity with other generation routes).
    if (!c.req.header('x-internal-token')) {
      c.var.logger
        .withMetadata({ route: 'docx' })
        .warn('x-internal-token absent — allowed in Phase 1, will be required Phase 2');
    }

    const extractionDoc: ExtractResponse['document'] = cached.document;
    // TODO(ADR-0008): extractionId is currently a fileHash alias; migrate to
    // normalized-text hash (BOW text → sha256) and a durable api-owned row.

    const fields = resolveSystemFields(body, extractionDoc);
    const buffer = await assembleDocx(body.lessonPlan, fields);

    c.header('Content-Disposition', 'attachment; filename="lesson-plan.docx"');
    c.header('X-Generated-At', fields.generationMetadata.generatedAt);
    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  return app;
}
