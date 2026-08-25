import { LessonPlanResponseSchema } from '@eduksource/schemas/lesson-plan.js';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ChatDetailedResult, ChatMessage, ChatOptions } from '../lib/ai/client.js';
import { chatDetailed } from '../lib/ai/client.js';
import { primaryContextWindow } from '../lib/ai/providers.js';
import { extractionCache } from '../lib/cache.js';
import { buildMaxCompletionTokens, estimateTokens } from '../lib/tokens.js';
import type { HonoSchema } from '../lib/types.js';
import type { ExtractResponse, SkillsFocus } from '../schemas/extract.js';

const SessionsOverrideSchema = z.coerce.number().int().min(1).max(7).optional();

export const GenerateLessonPlanRequestSchema = z.object({
  extractionId: z.string().min(1),
  termLabel: z.string().min(1),
  weekLabel: z.string().min(1),
  sessionsOverride: SessionsOverrideSchema,
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
});

type LessonPlanContext = {
  learningArea: string;
  gradeLevel: string;
  contentStandard: string[];
  performanceStandard: string[];
  skillsFocus: SkillsFocus | null;
  strands: ExtractResponse['document']['terms'][number]['blocks'][number]['strands'];
  suggestedActivities: string[];
  suggestedPerformanceTasks: string[];
  durationDays: number;
  extractionNotes: string | null;
};

class ContextError extends Error {
  code: 'TERM_NOT_FOUND' | 'WEEK_NOT_FOUND';
  availableTerms?: string[];
  availableWeeks?: string[];
  constructor(
    code: 'TERM_NOT_FOUND' | 'WEEK_NOT_FOUND',
    message: string,
    labels: { availableTerms?: string[]; availableWeeks?: string[] }
  ) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
    this.availableTerms = labels.availableTerms;
    this.availableWeeks = labels.availableWeeks;
  }
}

export function buildLessonPlanContext(
  extraction: ExtractResponse,
  termLabel: string,
  weekLabel: string
): LessonPlanContext {
  const term = extraction.document.terms.find((t) => t.termLabel === termLabel);
  if (!term) {
    throw new ContextError('TERM_NOT_FOUND', `Term "${termLabel}" not found`, {
      availableTerms: extraction.document.terms.map((t) => t.termLabel),
    });
  }
  const block = term.blocks.find((b) => b.weekLabel === weekLabel);
  if (!block) {
    throw new ContextError('WEEK_NOT_FOUND', `Week "${weekLabel}" not found in ${termLabel}`, {
      availableWeeks: term.blocks.map((b) => b.weekLabel),
    });
  }
  return {
    learningArea: extraction.document.learningArea,
    gradeLevel: extraction.document.gradeLevel,
    contentStandard: block.contentStandard ?? term.contentStandard ?? [],
    performanceStandard: block.performanceStandard ?? term.performanceStandard ?? [],
    skillsFocus: block.skillsFocus ?? term.skillsFocus ?? null,
    strands: block.strands,
    suggestedActivities: term.suggestedActivities ?? [],
    suggestedPerformanceTasks: term.suggestedPerformanceTasks ?? [],
    durationDays: block.durationDays ?? 1,
    extractionNotes: block.extractionNotes,
  };
}

const EXEMPLAR = `Example session (Week 1 S1 style — quality anchor, not to copy verbatim):
Learning Objectives: 1. identify and describe major key developmental stages… 2. demonstrate ability to create a visual timeline… 3. express personal reflections…
Learner Context: Learners are aware of different key developmental stages but may not fully understand specific changes…
Pre-Lesson: Greetings & Prayer, Recall, Objectives, Activity: How well do you know yourself? (peer sharing 2 min)
Flow: The teacher presents lesson objectives and expected outputs → wellness check → Activity: How well do you know yourself? → …`;

export function buildSystemPrompt(): string {
  return `You are a Philippine DepEd lesson-plan generator. Produce curriculum-faithful JSON only, matching the lesson-plan template.

Write for a teacher, not a database. Apply the Learning Design Principles to every session's Flow:
1. Make objectives clear before the task.
2. Guide learners before independent work.
3. Check well-being, understanding, and mastery mid-session.
4. Connect to past competencies.
5. Encourage collaboration.
6. Invite personal reflection on relevance.
7. Ensure inclusion for varied abilities, learning styles, and contexts.

Rubric: Intentions must be clearly stated and coherent across sections. Learning Experience must be clear enough that another teacher can implement without extra explanation. Assessments must be integrated throughout and generate evidence of learning, with varied response formats / accommodations per session.

System fields NOT available to you: teacherName, sectionLabel, dates, schedule, reflections, signature block, letterhead, rubric page. Where the template asks for an unavailable field, use exactly the literal "N/A" (case-sensitive). If no genuine cross-subject link exists for a session, opportunitiesForIntegration must be exactly "N/A". Never populate reflections — always null; reflections are filled by the teacher after delivery.

Produce N distinct sessions: distinct Learning Objectives (3 per session, observable verbs), distinct Learner Context, distinct Flow sequences, and varied Formative Assessments rotating formats (MCQ / short-answer / scenario-based / reflective) across sessions. Do not copy-paste one session's content into another.

Return only valid JSON matching the provided schema, no prose, no code fences. Begin with "{" and end with "}".`;
}

export function buildUserPrompt(ctx: LessonPlanContext, numberOfSessions: number): string {
  return `Generate a lesson plan for ${numberOfSessions} session(s).

Filtered BOW context (single week-block, not full BOW):
${JSON.stringify(ctx, null, 2)}

Expected sessions: ${numberOfSessions}

${EXEMPLAR}

Produce one lesson plan with exactly ${numberOfSessions} sessions; each session's fields must be distinct (see distinctness instruction above).`;
}

export function createLessonPlanRoutes() {
  const app = new Hono<HonoSchema>();

  app.post('/generate', zValidator('json', GenerateLessonPlanRequestSchema), async (c) => {
    const body = c.req.valid('json');

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

    let ctx: LessonPlanContext;
    let numberOfSessions: number;
    try {
      ctx = buildLessonPlanContext(cached, body.termLabel, body.weekLabel);
      numberOfSessions = body.sessionsOverride ?? ctx.durationDays;
      if (numberOfSessions < 1 || numberOfSessions > 7) {
        return c.json(
          { error: 'Session count must resolve to 1–7 (sessionsOverride or durationDays)' },
          400
        );
      }
    } catch (err) {
      if (err instanceof ContextError) {
        if (err.code === 'TERM_NOT_FOUND') {
          return c.json(
            { error: err.message, code: err.code, availableTerms: err.availableTerms },
            404
          );
        }
        return c.json(
          { error: err.message, code: err.code, availableWeeks: err.availableWeeks },
          404
        );
      }
      throw err;
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(ctx, numberOfSessions);
    const promptForBudget = systemPrompt + userPrompt;
    // TODO(ADR-0008): extractionId is currently a fileHash alias; migrate to
    // normalized-text hash (BOW text → sha256) and a durable api-owned row.
    void promptForBudget;

    // Phase 1: missing internal token is warn-only; Phase 2 hardens to 401.
    if (!c.req.header('x-internal-token')) {
      c.var.logger
        .withMetadata({ extractionId: body.extractionId, route: 'lesson-plan' })
        .warn('x-internal-token absent — allowed in Phase 1, will be required Phase 2');
    }

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

    // Non-dryRun path — full LLM wiring (Task 4).
    const maxCompletionTokens = buildMaxCompletionTokens(primaryContextWindow, promptForBudget);

    const lessonPlanJsonSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: {
            lessonTitle: { type: 'string' },
            numberOfSessions: { type: 'integer', minimum: 1 },
            referencesFromBow: { type: 'array', items: { type: 'string' } },
          },
          required: ['lessonTitle', 'numberOfSessions', 'referencesFromBow'],
        },
        intentions: {
          type: 'object',
          properties: {
            learningCompetencyAndStandards: {
              type: 'object',
              properties: {
                contentStandard: { type: 'array', items: { type: 'string' } },
                performanceStandard: { type: 'array', items: { type: 'string' } },
                learningCompetency: { type: 'string' },
              },
              required: ['contentStandard', 'performanceStandard', 'learningCompetency'],
            },
            sessions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  sessionLabel: { type: 'string' },
                  learningObjectives: { type: 'array', items: { type: 'string' } },
                  learnerContext: { type: 'string' },
                },
                required: ['sessionLabel', 'learningObjectives', 'learnerContext'],
              },
            },
          },
          required: ['learningCompetencyAndStandards', 'sessions'],
        },
        learningExperience: {
          type: 'object',
          properties: {
            sessions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  sessionLabel: { type: 'string' },
                  preLesson: { type: 'string' },
                  flow: { type: 'string' },
                  learningResources: { type: 'array', items: { type: 'string' } },
                  opportunitiesForIntegration: { type: 'string' },
                },
                required: [
                  'sessionLabel',
                  'preLesson',
                  'flow',
                  'learningResources',
                  'opportunitiesForIntegration',
                ],
              },
            },
          },
          required: ['sessions'],
        },
        assessment: {
          type: 'object',
          properties: {
            sessions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  sessionLabel: { type: 'string' },
                  formativeAssessment: { type: 'string' },
                },
                required: ['sessionLabel', 'formativeAssessment'],
              },
            },
          },
          required: ['sessions'],
        },
        waysForward: {
          type: 'object',
          properties: {
            sessions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  sessionLabel: { type: 'string' },
                  extendedLearningOpportunities: { type: 'string' },
                  reflections: { type: 'null' },
                },
                required: ['sessionLabel', 'extendedLearningOpportunities', 'reflections'],
              },
            },
          },
          required: ['sessions'],
        },
      },
      required: ['meta', 'intentions', 'learningExperience', 'assessment', 'waysForward'],
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
            json_schema: { name: 'LessonPlanResponse', schema: lessonPlanJsonSchema, strict: true },
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/response_format|json_schema|unsupported/i.test(msg)) {
          // Single prose fallback — same messages without response_format.
          return chatDetailed(messages, opts);
        }
        throw err;
      }
    };

    const tryParse = (content: string | null) => {
      if (content === null) throw new Error('Empty LLM response');
      return LessonPlanResponseSchema.parse(JSON.parse(content));
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
      try {
        const lessonPlan = tryParse(first.content);
        return c.json({
          lessonPlan,
          generationMetadata: {
            provider: providerUsed,
            model: modelUsed,
            generatedAt: new Date().toISOString(),
            retried,
          },
        });
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
        try {
          const lessonPlan = tryParse(second.content);
          return c.json({
            lessonPlan,
            generationMetadata: {
              provider: providerUsed,
              model: modelUsed,
              generatedAt: new Date().toISOString(),
              retried,
            },
          });
        } catch (secondErr) {
          return c.json(
            {
              error: 'Lesson plan generation failed validation after retry',
              validationErrors: secondErr instanceof Error ? secondErr.message : String(secondErr),
              raw: (second.content ?? '').slice(0, 8192),
              provider: providerUsed,
              model: modelUsed,
            },
            502
          );
        }
      }
    } catch (fatal) {
      // Provider chain exhausted or unrecoverable — 502 with trimmed raw.
      return c.json(
        {
          error: 'Lesson plan generation failed',
          validationErrors: fatal instanceof Error ? fatal.message : String(fatal),
          raw: (rawContent ?? '').slice(0, 8192),
          provider: providerUsed,
          model: modelUsed,
        },
        502
      );
    }
  });

  return app;
}
