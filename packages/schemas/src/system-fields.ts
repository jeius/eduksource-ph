import { z } from 'zod';

/**
 * Shared SystemFields contract — the assembly input for DOCX and PPTX
 * document generation (spec §3; grilling Q2/Q3).
 *
 * Consumed by both assemblers so header identity fields have exactly one
 * definition. Signature fields (preparedBy/checkedBy/notedBy + roles, per
 * the DLL 3-person block) and the letterhead stub are optional: the PPTX-era
 * shape without them remains a valid subset.
 */

export const SystemFieldsSchema = z.object({
  teacherName: z.string().min(1).nullable(),
  sectionLabel: z.string().min(1).nullable(),
  gradeLevel: z.string().min(1),
  learningArea: z.string().min(1),
  generationMetadata: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    generatedAt: z.string().min(1),
  }),
  bowReference: z.string().min(1),
  preparedBy: z.string().min(1).nullable().optional(),
  checkedBy: z.string().min(1).nullable().optional(),
  notedBy: z.string().min(1).nullable().optional(),
  checkedByRole: z.string().min(1).optional(),
  notedByRole: z.string().min(1).optional(),
  letterhead: z.object({ lines: z.array(z.string().min(1)).min(1) }).nullable().optional(),
});

export type SystemFields = z.infer<typeof SystemFieldsSchema>;
