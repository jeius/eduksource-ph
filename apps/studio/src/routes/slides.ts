import { LessonPlanResponseSchema } from '@eduksource/schemas/lesson-plan.js';
import type { SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { SlideDeckSpecSchema } from '@eduksource/schemas/slide-deck.js';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ChatDetailedResult, ChatMessage, ChatOptions } from '../lib/ai/client.js';
import { chatDetailed } from '../lib/ai/client.js';
import { primaryContextWindow } from '../lib/ai/providers.js';
import { extractionCache } from '../lib/cache.js';
import { assemblePptx } from '../lib/pptx.js';
import type { SystemFields } from '../lib/pptx.js';
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

      // Defined once for both dryRun-independence and the wired LLM call below.
      const maxCompletionTokens = buildMaxCompletionTokens(primaryContextWindow, promptForBudget);

      const slideDeckJsonSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          sessions: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: {
              type: 'object',
              properties: {
                sessionLabel: { type: 'string' },
                slides: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      layout: {
                        type: 'string',
                        enum: [
                          'title',
                          'objectives',
                          'motivation',
                          'content',
                          'activity',
                          'checkForUnderstanding',
                          'closing',
                        ],
                      },
                      heading: { type: 'string' },
                      bullets: { type: 'array', items: { type: 'string' }, maxItems: 5 },
                      speakerNotes: { type: 'string' },
                      imagePrompt: { type: ['string', 'null'] },
                    },
                    required: ['layout', 'heading'],
                  },
                },
              },
              required: ['sessionLabel', 'slides'],
            },
          },
        },
        required: ['title', 'sessions'],
      };

      let retried = false;
      let rawContent: string | null = null;
      let providerUsed = body.provider ?? 'primary';
      let modelUsed = body.model ?? 'default';

      const callOnce = async (
        messages: ChatMessage[],
        opts: ChatOptions
      ): Promise<ChatDetailedResult> => {
        try {
          return await chatDetailed(messages, {
            ...opts,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'SlideDeckSpec', schema: slideDeckJsonSchema, strict: false },
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/response_format|json_schema|unsupported/i.test(msg)) {
            // Single prose fallback — same messages without response_format.
            c.var.logger
              .withMetadata({ route: 'slides' })
              .warn(`json_schema response_format rejected — falling back to prose prompt: ${msg}`);
            return chatDetailed(messages, opts);
          }
          throw err;
        }
      };

      const tryParse = (content: string | null) => {
        if (content === null) throw new Error('Empty LLM response');
        return SlideDeckSpecSchema.parse(JSON.parse(content));
      };

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      const opts: ChatOptions = {
        task: 'lesson_plan',
        max_completion_tokens: maxCompletionTokens,
        model: body.model,
      };

      try {
        const first = await callOnce(messages, opts);
        rawContent = first.content;
        providerUsed = (first as { provider?: string }).provider ?? providerUsed;
        modelUsed = (first as { model?: string }).model ?? modelUsed;

        let deck: SlideDeckSpec;
        try {
          deck = tryParse(first.content);
        } catch (firstErr) {
          const validationMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          retried = true;
          const retryMessages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `${userPrompt}\n\nPrevious output failed validation:\n - ${validationMsg}\nReturn only valid JSON.`,
            },
          ];
          const second = await callOnce(retryMessages, opts);
          rawContent = second.content;
          deck = tryParse(second.content); // throws to fatal handler on repeat failure
        }

        const systemFields: SystemFields = {
          teacherName: body.systemFields?.teacherName ?? null,
          sectionLabel: body.systemFields?.sectionLabel ?? null,
          gradeLevel: extractionDoc.gradeLevel,
          learningArea: extractionDoc.learningArea,
          generationMetadata: {
            provider: providerUsed,
            model: modelUsed,
            generatedAt: new Date().toISOString(),
          },
          bowReference: body.systemFields?.bowReference ?? `DepEd BOW — ${body.termLabel}, ${body.weekLabel}`,
        };

        const pptxBuffer = await assemblePptx(deck, systemFields);

        c.header('Content-Disposition', 'attachment; filename="slides.pptx"');
        c.header('X-Provider', providerUsed);
        c.header('X-Model', modelUsed);
        c.header('X-Retried', String(retried));
        c.header('X-Generated-At', systemFields.generationMetadata.generatedAt);
        // Hono's body Data is Uint8Array<ArrayBuffer>; Node Buffer<ArrayBufferLike> isn't assignable — copy into a plain-backed view.
        return c.body(new Uint8Array(pptxBuffer), 200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        });
      } catch (fatalOrValidation) {
        // retried=true reaching this catch means the second parse threw (first parse already failed).
        const isValidationExhausted = retried;
        const msg = fatalOrValidation instanceof Error ? fatalOrValidation.message : String(fatalOrValidation);
        if (isValidationExhausted) {
          return c.json(
            {
              error: 'Slide deck generation failed validation after retry',
              validationErrors: msg,
              raw: (rawContent ?? '').slice(0, 8192),
              provider: providerUsed,
              model: modelUsed,
            },
            502
          );
        }
        return c.json(
          {
            error: 'Slide deck generation failed',
            validationErrors: msg,
            raw: (rawContent ?? '').slice(0, 8192),
            provider: providerUsed,
            model: modelUsed,
          },
          502
        );
      }
    }
  );

  return app;
}
