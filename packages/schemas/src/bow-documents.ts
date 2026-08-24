import { z } from 'zod';

export const BowCreateSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i, 'contentHash must be 64-char hex'),
  gradeLevel: z.string().min(1).max(50),
  learningArea: z.string().min(1).max(100),
  schoolYear: z.string().min(1).max(20),
  r2JsonKey: z.string().min(1).max(500),
  r2PdfKey: z.string().min(1).max(500),
  extractionProvider: z.string().min(1).max(50),
  extractionModel: z.string().min(1).max(100),
});

export const BowParamsSchema = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/i) });
