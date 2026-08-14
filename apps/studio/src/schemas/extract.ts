import { z } from 'zod'

export const SkillsFocusItemSchema = z.object({
  text: z.string(),
  gloss: z.string().nullable(),
})

export const SkillsFocusSchema = z.object({
  sourceLabel: z.string(),
  items: z.array(SkillsFocusItemSchema).min(1),
})

export const BowStrandSchema = z.object({
  strandLabel: z.string().nullable(),
  topicLabel: z.string().nullable(),
  competenciesRaw: z.string(),
})

export const BowBlockSchema = z.object({
  weekLabel: z.string(), // verbatim: "*", "1 to 2 (10 days)", "Linggo 1"
  durationDays: z.number().int().positive().nullable(), // only if explicitly stated
  contentStandard: z.array(z.string()).nullable(),
  performanceStandard: z.array(z.string()).nullable(),
  skillsFocus: SkillsFocusSchema.nullable(),
  strands: z.array(BowStrandSchema).min(1),
  extractionNotes: z.string().nullable(),
})

export const BowTermSchema = z.object({
  termLabel: z.string(), // verbatim, source language: "First Term" | "Unang Termino"
  contentStandard: z.array(z.string()).nullable(),
  performanceStandard: z.array(z.string()).nullable(),
  skillsFocus: SkillsFocusSchema.nullable(),
  suggestedActivities: z.array(z.string()).nullable(),
  suggestedPerformanceTasks: z.array(z.string()).nullable(),
  blocks: z.array(BowBlockSchema),
})

export const BowDocumentSchema = z.object({
  learningArea: z.string(),
  gradeLevel: z.string(),
  documentNotes: z.string().nullable(),
  terms: z.array(BowTermSchema),
})

export const ExtractResponseSchema = z.object({
  text: z.string(),
  pages: z.number().int().nonnegative(),
  document: BowDocumentSchema,
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
})

// Loose variants used as the LLM salvage boundary: identical shapes to the strict
// schemas but WITHOUT the min() constraints, so a block that fails strict
// validation is still parseable whole-document and salvageable per-block.
export const LooseSkillsFocusSchema = SkillsFocusSchema.extend({
  items: z.array(SkillsFocusItemSchema),
})

export const LooseBowBlockSchema = BowBlockSchema.extend({
  skillsFocus: LooseSkillsFocusSchema.nullable(),
  strands: z.array(BowStrandSchema),
})

export const LooseBowDocumentSchema = BowDocumentSchema.extend({
  terms: z.array(
    BowTermSchema.extend({
      blocks: z.array(LooseBowBlockSchema),
    })
  ),
})

export type SkillsFocusItem = z.infer<typeof SkillsFocusItemSchema>
export type SkillsFocus = z.infer<typeof SkillsFocusSchema>
export type BowStrand = z.infer<typeof BowStrandSchema>
export type BowBlock = z.infer<typeof BowBlockSchema>
export type BowTerm = z.infer<typeof BowTermSchema>
export type BowDocument = z.infer<typeof BowDocumentSchema>
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>
