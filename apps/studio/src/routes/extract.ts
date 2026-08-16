import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { extractionCache } from '../lib/cache.js';
import {
  defaultContextWindow,
  defaultModel,
  type NimUsage,
  nimChatDetailed,
  nimVisionChat,
} from '../lib/nim.js';
import { extractText, pdfPagesToPngs, TooManyPagesError } from '../lib/pdf.js';
import type { HonoSchema } from '../lib/types.js';
import {
  BowBlockSchema,
  type BowDocument,
  type BowTerm,
  type ExtractResponse,
  FileUploadSchema,
  LooseBowDocumentSchema,
} from '../schemas/extract.js';

const MAX_PAGES = 20;
const VISION_BATCH_SIZE = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const TOKEN_ESTIMATE_FACTOR = 1.3;
const TOKEN_BUDGET_RATIO = 0.8;
const MAX_EXTRACTION_OUTPUT_TOKENS = 32_768; // headroom for large single-term JSON
const MIN_TEXT_FOR_UNPDF = 100;
const VALID_BLOCK_RATIO = 0.8;

const SCHEMA_JSON = `{
  "learningArea": "string",
  "gradeLevel": "string",
  "documentNotes": "string | null",
  "terms": [
    {
      "termLabel": "string",
      "contentStandard": ["string"] | null,
      "performanceStandard": ["string"] | null,
      "skillsFocus": {
        "sourceLabel": "string",
        "items": [{ "text": "string", "gloss": "string | null" }]
      } | null,
      "suggestedActivities": ["string"] | null,
      "suggestedPerformanceTasks": ["string"] | null,
      "blocks": [
        {
          "weekLabel": "string",
          "durationDays": "number | null",
          "contentStandard": ["string"] | null,
          "performanceStandard": ["string"] | null,
          "skillsFocus": {
            "sourceLabel": "string",
            "items": [{ "text": "string", "gloss": "string | null" }]
          } | null,
          "strands": [
            {
              "strandLabel": "string | null",
              "topicLabel": "string | null",
              "competenciesRaw": "string"
            }
          ],
          "extractionNotes": "string | null"
        }
      ]
    }
  ]
}`;

function buildSystemPrompt(): string {
  return `You are extracting structured curriculum data from a Philippine DepEd Budget of Work (BOW)
document. Extract only what is explicitly present in the source text — never infer, estimate,
or invent a value.

Rules:
- If a field is not explicitly stated in the source (e.g. the Week column shows "*" instead of
  a number), output it verbatim as given ("*"), or null if truly absent. Never substitute a
  guessed number.
- Use the source document's own terminology for structural labels (e.g. "Term", not "Quarter")
  — do not rename or reinterpret document structure.
- This document's field labels may appear in Filipino instead of English (e.g. "Linggo" = Week,
  "Kasanayang Pampagkatuto" = Learning Competency, "Pamantayang Pangnilalaman" = Content
  Standard, "Pamantayan sa Pagganap" = Performance Standard, "Unang/Ikalawang/Ikatlong
  Termino" = First/Second/Third Term, "Baitang" = Grade). Recognize these by meaning and map
  them to the correct schema field, but store term/week labels verbatim in the source's own
  language — do not translate them yourself.
- Preserve competency lists as nested markdown exactly as they appear (including sub-bullets
  and lettered sub-points), rather than splitting each line into a separate object — a single
  competency often has multiple sub-elements that belong together.
- Content Standard and Performance Standard may be a single paragraph or a list of multiple
  distinct statements. Capture each as a separate array entry rather than merging them into
  one string. Capture them wherever they are explicitly stated in the source — per-term or
  per-week-block — do not assume one applies to blocks that do not restate it, and do not copy
  a term-level value down into blocks as if it were repeated.
- A single week block may contain more than one labeled strand or subject component (e.g. two
  subjects bundled under one week number, or two content strands like "Geometry" and "Algebra"
  in the same week). Extract each strand separately with its own label — do not merge multiple
  strands' competencies into one undifferentiated list.
- A strand or topic label may be stated once and apply to several following blocks without
  being restated. Do not infer or repeat a label onto a block that does not state one — leave
  it null.
- If the source includes a subject-specific field naming skills or values to be developed (e.g.
  "Values to be Developed," "Essential Life Skills"), capture the source's own field label
  verbatim along with each listed item. Preserve any parenthetical gloss given; leave gloss
  null if none is given — do not add a translation yourself.
- Capture any document-level notes that apply to the whole BOW rather than one term or week
  (e.g. scheduling/time-allocation notes) in documentNotes — do not attach them to an
  individual week block.
- If a value spans multiple lines, has OCR/extraction artifacts (stray characters, broken
  words), or appears to run two items together without proper spacing (a likely document
  artifact), reproduce it as-is rather than silently correcting or splitting it — flag the
  ambiguity in that block's extractionNotes field instead of fixing it yourself.

Return only valid JSON matching this schema, no other text. Do not include any
reasoning, analysis, planning, commentary, or explanation in your response.
Begin your response directly with the opening brace of the JSON object and end
with its closing brace. Do not wrap the JSON in markdown code fences.

Schema:
${SCHEMA_JSON}`;
}

function buildUserPrompt(extractedText: string): string {
  return `Extract structured data from the following BOW document text:

${extractedText}`;
}

function splitByTerm(text: string): string[] {
  const sections = text
    .split(
      /(?=First Term|Second Term|Third Term|Unang Termino|Ikalawang Termino|Ikatlong Termino)/i
    )
    .filter(Boolean);
  return sections.length > 0 ? sections : [text];
}

class ExtractionParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = 'ExtractionParseError';
    this.raw = raw;
  }
}

class ExtractionTruncatedError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = 'ExtractionTruncatedError';
    this.raw = raw;
  }
}

class ExtractionValidationError extends Error {
  omitted: number;
  total: number;
  constructor(omitted: number, total: number) {
    super(`Too many competency blocks failed validation (${omitted} of ${total} omitted)`);
    this.name = 'ExtractionValidationError';
    this.omitted = omitted;
    this.total = total;
  }
}

async function extractBowDocument(
  text: string
): Promise<{ document: BowDocument; usage: NimUsage }> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(text);
  const outputBudget = Math.floor(defaultContextWindow * TOKEN_BUDGET_RATIO);
  // Output must never push input+output past the provider's window: cap it at
  // the window budget minus the estimated prompt, and never above the fixed
  // per-task headroom. Clamped to 1 so a tiny window can't produce 0.
  const maxCompletionTokens = Math.min(
    MAX_EXTRACTION_OUTPUT_TOKENS,
    Math.max(1, outputBudget - estimateTokens(systemPrompt + userPrompt))
  );
  const extractionOpts = {
    model: defaultModel,
    max_completion_tokens: maxCompletionTokens,
  };

  const first = await nimChatDetailed(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    extractionOpts
  );

  try {
    const document = LooseBowDocumentSchema.parse(JSON.parse(first.content ?? ''));
    return { document, usage: first.usage };
  } catch (err) {
    // If the model hit its output-token cap the retry will truncate the same
    // way — signal truncation so the caller can split by term instead.
    if (first.finishReason === 'length') {
      throw new ExtractionTruncatedError(first.content ?? '', 'LLM output truncated (token limit)');
    }

    const errorMsg = err instanceof Error ? err.message : 'Unknown parse error';
    const retry = await nimChatDetailed(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${userPrompt}\n\nPrevious output failed JSON parse: ${errorMsg}. Return only valid JSON.`,
        },
      ],
      extractionOpts
    );
    try {
      const document = LooseBowDocumentSchema.parse(JSON.parse(retry.content ?? ''));
      return { document, usage: mergeUsage(first.usage, retry.usage) };
    } catch (retryErr) {
      if (retry.finishReason === 'length') {
        throw new ExtractionTruncatedError(
          retry.content ?? '',
          'LLM output truncated (token limit)'
        );
      }
      throw new ExtractionParseError(
        retry.content ?? '',
        `Failed to parse LLM output: ${retryErr instanceof Error ? retryErr.message : 'Unknown'}`
      );
    }
  }
}

function mergeUsage(...usages: NimUsage[]): NimUsage {
  return usages.reduce(
    (acc, u) => ({ input: acc.input + u.input, output: acc.output + u.output }),
    { input: 0, output: 0 }
  );
}

async function extractByTermSections(
  text: string
): Promise<{ document: BowDocument; usage: NimUsage }> {
  const sections = splitByTerm(text);
  const usages: NimUsage[] = [];
  const terms: BowTerm[] = [];
  let learningArea = '';
  let gradeLevel = '';
  let documentNotes: string | null = null;

  for (const section of sections) {
    const { document, usage } = await extractBowDocument(section);
    usages.push(usage);
    terms.push(...document.terms);
    learningArea ||= document.learningArea;
    gradeLevel ||= document.gradeLevel;
    documentNotes ??= document.documentNotes;
  }

  return {
    document: { learningArea, gradeLevel, documentNotes, terms },
    usage: mergeUsage(...usages),
  };
}

function estimateTokens(input: string): number {
  return Math.ceil(input.length * TOKEN_ESTIMATE_FACTOR);
}

async function extractDocument(text: string): Promise<{ document: BowDocument; usage: NimUsage }> {
  const estimatedTokens = estimateTokens(text + buildSystemPrompt());
  const maxTokens = Math.floor(defaultContextWindow * TOKEN_BUDGET_RATIO);

  if (estimatedTokens > maxTokens) {
    return extractByTermSections(text);
  }

  try {
    return await extractBowDocument(text);
  } catch (err) {
    // A single call's JSON output hit the model's token cap — retrying would
    // truncate the same way. Recover by extracting per-term instead, which
    // shrinks each response below the cap.
    if (err instanceof ExtractionTruncatedError) {
      return extractByTermSections(text);
    }
    throw err;
  }
}

function validateDocument(document: BowDocument): {
  document: BowDocument;
  warnings: string[];
  notes: string[];
} {
  const warnings: string[] = [];
  const notes: string[] = [];
  let totalBlocks = 0;
  let omittedBlocks = 0;

  const terms = document.terms.map((term) => ({
    ...term,
    blocks: term.blocks.filter((block) => {
      totalBlocks++;
      const parsed = BowBlockSchema.safeParse(block);
      if (parsed.success) {
        if (block.extractionNotes) notes.push(block.extractionNotes);
        return true;
      }
      omittedBlocks++;
      warnings.push(
        `Competency block validation failed (week ${block.weekLabel}): ${parsed.error.message}`
      );
      return false;
    }),
  }));

  if (totalBlocks > 0 && omittedBlocks / totalBlocks > 1 - VALID_BLOCK_RATIO) {
    throw new ExtractionValidationError(omittedBlocks, totalBlocks);
  }

  if (omittedBlocks > 0) {
    warnings.push(`${omittedBlocks} competency blocks omitted due to validation failure`);
  }

  return { document: { ...document, terms }, warnings, notes };
}

export function createExtractRoutes() {
  const app = new Hono<HonoSchema>();

  app.post('/extract', zValidator('form', FileUploadSchema), async (c) => {
    const startMs = Date.now();
    const { file } = c.req.valid('form');

    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large (max 10 MB)' }, 413);
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const fileHash = await extractionCache.hashFile(buffer);

    const cached = extractionCache.get(fileHash);
    if (cached) {
      c.var.logger
        .withMetadata({
          fileHash,
          cacheHit: true,
          path: 'cache',
          latencyMs: Date.now() - startMs,
          pages: cached.pages,
          textLength: cached.text.length,
          learningArea: cached.document.learningArea,
          termCount: cached.document.terms.length,
        })
        .info('extraction cache hit');
      return c.json(cached);
    }

    let text = '';
    let pages = 0;
    let path: 'unpdf' | 'vision-fallback' = 'unpdf';

    try {
      const result = await extractText(buffer);
      text = result.text;
      pages = result.pages;
    } catch {
      path = 'vision-fallback';
    }

    if (pages > MAX_PAGES) {
      return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413);
    }

    if (!text || text.length < MIN_TEXT_FOR_UNPDF) {
      path = 'vision-fallback';
      try {
        const pageImages = await pdfPagesToPngs(buffer, MAX_PAGES);
        pages = pageImages.length;
        const prompt = 'Extract all text from this BOW document. Return raw text only.';
        const chunks: string[] = [];
        for (let i = 0; i < pageImages.length; i += VISION_BATCH_SIZE) {
          const batch = pageImages.slice(i, i + VISION_BATCH_SIZE);
          const batchText = await nimVisionChat(batch, prompt);
          chunks.push(batchText);
        }
        text = chunks.join('\n\n');
      } catch (err) {
        if (err instanceof TooManyPagesError) {
          return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413);
        }
        c.var.logger
          .withError(err as Error)
          .withMetadata({
            fileHash,
            path: 'vision-fallback',
          })
          .error('Vision fallback failed (unpdf + render/OCR both errored)');
        return c.json({ error: 'Failed to extract text from PDF' }, 500);
      }
    }

    if (!text.trim()) {
      const emptyResponse: ExtractResponse = {
        text,
        pages,
        document: { learningArea: '', gradeLevel: '', documentNotes: null, terms: [] },
        warnings: [],
        notes: [],
      };
      extractionCache.set(fileHash, emptyResponse);
      return c.json(emptyResponse);
    }

    let document: BowDocument;
    let usage: NimUsage;
    let validated: BowDocument;
    let warnings: string[];
    let notes: string[];
    try {
      const result = await extractDocument(text);
      document = result.document;
      usage = result.usage;
      const validatedResult = validateDocument(document);
      validated = validatedResult.document;
      warnings = validatedResult.warnings;
      notes = validatedResult.notes;
    } catch (err) {
      if (err instanceof ExtractionParseError) {
        return c.json({ error: err.message, raw: err.raw }, 500);
      }
      if (err instanceof ExtractionTruncatedError) {
        return c.json({ error: err.message, raw: err.raw }, 500);
      }
      if (err instanceof ExtractionValidationError) {
        return c.json({ error: err.message, omitted: err.omitted }, 500);
      }
      throw err;
    }

    const response: ExtractResponse = { text, pages, document: validated, warnings, notes };

    extractionCache.set(fileHash, response);

    c.var.logger
      .withMetadata({
        fileHash,
        pages,
        textLength: text.length,
        tokensUsed: usage,
        latencyMs: Date.now() - startMs,
        cacheHit: false,
        path,
        learningArea: validated.learningArea,
        termCount: validated.terms.length,
      })
      .info('extraction completed');

    return c.json(response);
  });

  return app;
}
