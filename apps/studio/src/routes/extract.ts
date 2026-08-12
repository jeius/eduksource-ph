import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { extractionCache } from '../lib/cache.js'
import { nimChat, nimVisionChat } from '../lib/nim.js'
import { extractText } from '../lib/pdf.js'
import {
  type BowCompetencyGroup,
  BowCompetencyGroupSchema,
  type ExtractResponse,
  ExtractResponseSchema,
} from '../schemas/extract.js'

const MAX_PAGES = 50
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const TOKEN_ESTIMATE_FACTOR = 1.3
const TOKEN_BUDGET_RATIO = 0.8
const CONTEXT_WINDOW = 128_000 // NIM model context window
const MIN_TEXT_FOR_UNPDF = 100

const FileUploadSchema = z.object({
  file: z.instanceof(File).refine((f) => f.type === 'application/pdf', 'Must be PDF'),
})

function buildSystemPrompt(): string {
  return `You are extracting structured curriculum data from a Philippine DepEd Budget of Work (BOW) document. Extract only what is explicitly present in the source text — never infer, estimate, or invent a value.

Rules:
- If a field is not explicitly stated in the source (e.g. the Week column shows "_" instead of a number), output it verbatim as given ("_"), or null if truly absent. Never substitute a guessed number.
- Use the source document's own terminology for structural labels (e.g. "Term", not "Quarter") — do not rename or reinterpret document structure.
- Preserve competency lists as nested markdown exactly as they appear (including sub-bullets), rather than splitting each line into a separate object — a single competency often has multiple sub-elements that belong together.
- Capture Content Standard and Performance Standard for each term exactly as written.
- If a value spans multiple lines or has OCR/extraction artifacts (stray characters, broken words), reproduce it as-is rather than silently correcting it — flag uncertainty in a "notes" field instead of fixing it yourself.

Return only valid JSON matching this schema:
{
  "terms": [
    {
      "termLabel": "string",
      "contentStandard": "string",
      "performanceStandard": "string",
      "competencyGroups": [
        {
          "topicLabel": "string",
          "subheading": "string | null",
          "week": "string | null",
          "competenciesRaw": "string"
        }
      ]
    }
  ]
}`
}

function buildUserPrompt(extractedText: string): string {
  return `Extract structured data from the following BOW document text:

${extractedText}`
}

async function extractAllTerms(text: string): Promise<ExtractResponse['terms']> {
  const prompt = buildUserPrompt(text)
  const systemPrompt = buildSystemPrompt()

  // First attempt
  let content =
    (await nimChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ])) ?? ''

  let parsed: { terms?: ExtractResponse['terms'] }
  let rawTerms: ExtractResponse['terms']

  try {
    parsed = JSON.parse(content)
    rawTerms = parsed.terms ?? []
  } catch (e) {
    // Retry once with error feedback
    const errorMsg = e instanceof Error ? e.message : 'Unknown parse error'
    content =
      (await nimChat([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${prompt}\n\nPrevious output failed JSON parse: ${errorMsg}. Return only valid JSON.`,
        },
      ])) ?? ''
    parsed = JSON.parse(content)
    rawTerms = parsed.terms ?? []
  }

  return rawTerms
}

async function extractSingleTerm(text: string): Promise<ExtractResponse['terms'][0] | null> {
  const prompt = buildUserPrompt(text)
  const systemPrompt = buildSystemPrompt()

  try {
    const content =
      (await nimChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ])) ?? ''
    const parsed = JSON.parse(content)
    const terms = ExtractResponseSchema.shape.terms.parse(parsed.terms)
    return terms[0] ?? null
  } catch {
    return null
  }
}

function splitByTerm(text: string): string[] {
  // Split on term boundaries (case insensitive)
  const sections = text.split(/(?=First Term|Second Term|Third Term)/i).filter(Boolean)
  return sections.length > 0 ? sections : [text]
}

function validateCompetencyGroups(terms: ExtractResponse['terms']): {
  validGroups: BowCompetencyGroup[]
  warnings: string[]
} {
  const validGroups: BowCompetencyGroup[] = []
  const warnings: string[] = []
  let totalGroups = 0

  for (const term of terms) {
    for (const group of term.competencyGroups) {
      totalGroups++
      const parsed = BowCompetencyGroupSchema.safeParse(group)
      if (parsed.success) {
        validGroups.push(parsed.data)
      } else {
        warnings.push(
          `Competency group validation failed (${group.topicLabel}): ${parsed.error.message}`
        )
      }
    }
  }

  if (validGroups.length < totalGroups) {
    warnings.push(
      `${totalGroups - validGroups.length} competency groups omitted due to validation failure`
    )
  }

  return { validGroups, warnings }
}

function filterValidGroups(
  terms: ExtractResponse['terms'],
  validGroups: BowCompetencyGroup[]
): ExtractResponse['terms'] {
  const validTopics = new Set(validGroups.map((g) => g.topicLabel))
  return terms.map((term) => ({
    ...term,
    competencyGroups: term.competencyGroups.filter((g) => validTopics.has(g.topicLabel)),
  }))
}

export function createExtractRoutes() {
  const app = new Hono()

  app.post('/extract', zValidator('form', FileUploadSchema), async (c) => {
    const startMs = Date.now()
    const { file } = c.req.valid('form')

    // Size check
    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large (max 10 MB)' }, 413)
    }

    const buffer = new Uint8Array(await file.arrayBuffer())
    const fileHash = await extractionCache.hashFile(buffer)

    // Cache check
    const cached = extractionCache.get(fileHash)
    if (cached) {
      console.log(
        JSON.stringify({
          fileHash,
          cacheHit: true,
          path: 'cache',
          latencyMs: Date.now() - startMs,
        })
      )
      return c.json(cached)
    }

    // Extract text via unpdf
    let { text, pages } = await extractText(buffer)
    let path: 'unpdf' | 'vision-fallback' = 'unpdf'

    // Page limit check (after extraction)
    if (pages > MAX_PAGES) {
      return c.json({ error: `Too many pages (max ${MAX_PAGES})` }, 413)
    }

    // Vision fallback if text too short
    if (!text || text.length < MIN_TEXT_FOR_UNPDF) {
      path = 'vision-fallback'
      const base64 = Buffer.from(buffer).toString('base64')
      text = await nimVisionChat(
        base64,
        'Extract all text from this BOW document. Return raw text only.'
      )
    }

    // Token budget check
    const estimatedTokens = Math.ceil(text.length * TOKEN_ESTIMATE_FACTOR)
    const maxTokens = Math.floor(CONTEXT_WINDOW * TOKEN_BUDGET_RATIO)
    let terms: ExtractResponse['terms'] = []

    if (estimatedTokens > maxTokens) {
      // Split by term and process each separately
      const termSections = splitByTerm(text)
      for (const section of termSections) {
        const termResult = await extractSingleTerm(section)
        if (termResult) terms.push(termResult)
      }
    } else {
      // Single call for all terms
      terms = await extractAllTerms(text)
    }

    // Validate each competency group
    const { validGroups, warnings } = validateCompetencyGroups(terms)

    const response: ExtractResponse = {
      text,
      pages,
      terms: filterValidGroups(terms, validGroups),
      warnings,
      notes: [],
    }

    // Cache result
    extractionCache.set(fileHash, response)

    // Log structured
    console.log(
      JSON.stringify({
        fileHash,
        pages,
        textLength: text.length,
        tokensUsed: estimatedTokens,
        latencyMs: Date.now() - startMs,
        cacheHit: false,
        path,
      })
    )

    return c.json(response)
  })

  return app
}
