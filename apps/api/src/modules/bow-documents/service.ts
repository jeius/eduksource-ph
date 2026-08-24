import type { DrizzleDB } from '@eduksource/db';
import { bowDocuments } from '@eduksource/db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../../shared/errors.js';

export async function getBow(db: DrizzleDB, hash: string) {
  const [row] = await db
    .select()
    .from(bowDocuments)
    .where(eq(bowDocuments.contentHash, hash.toLowerCase()));
  if (!row) throw AppError.notFound('BOW Document not found');
  return row;
}

export async function createBow(db: DrizzleDB, input: unknown) {
  const data = input as {
    contentHash: string;
    gradeLevel: string;
    learningArea: string;
    schoolYear: string;
    r2JsonKey: string;
    r2PdfKey: string;
    extractionProvider: string;
    extractionModel: string;
  };
  try {
    const [row] = await db
      .insert(bowDocuments)
      .values({
        contentHash: data.contentHash.toLowerCase(),
        gradeLevel: data.gradeLevel,
        learningArea: data.learningArea,
        schoolYear: data.schoolYear,
        r2JsonKey: data.r2JsonKey,
        r2PdfKey: data.r2PdfKey,
        extractionProvider: data.extractionProvider,
        extractionModel: data.extractionModel,
      })
      .returning();
    return row;
  } catch (e: unknown) {
    const msg = String(e);
    const err = e as { message?: string; code?: string; cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    if (
      msg.includes('duplicate') ||
      msg.includes('unique') ||
      msg.includes('23505') ||
      code === '23505'
    ) {
      throw AppError.conflict('BOW Document already exists');
    }
    throw e;
  }
}
