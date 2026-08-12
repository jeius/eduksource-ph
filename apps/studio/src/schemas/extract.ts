import { z } from 'zod'

export const BowCompetencyGroupSchema = z.object({
  topicLabel: z.string(),
  subheading: z.string().nullable(),
  week: z.string().nullable(), // verbatim: "*", "1", etc.
  competenciesRaw: z.string(), // nested markdown preserved
})

export const BowTermSchema = z.object({
  termLabel: z.string(),
  contentStandard: z.string(),
  performanceStandard: z.string(),
  competencyGroups: z.array(BowCompetencyGroupSchema),
})

export const ExtractResponseSchema = z.object({
  text: z.string(),
  pages: z.number().int().nonnegative(),
  terms: z.array(BowTermSchema),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
})

export type BowCompetencyGroup = z.infer<typeof BowCompetencyGroupSchema>
export type BowTerm = z.infer<typeof BowTermSchema>
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>
