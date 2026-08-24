import { pgTable, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

export const bowDocuments = pgTable('bow_documents', {
  contentHash: varchar('content_hash', { length: 64 }).primaryKey(),
  gradeLevel: varchar('grade_level', { length: 50 }).notNull(),
  learningArea: varchar('learning_area', { length: 100 }).notNull(),
  schoolYear: varchar('school_year', { length: 20 }).notNull(),
  r2JsonKey: varchar('r2_json_key', { length: 500 }).notNull(),
  r2PdfKey: varchar('r2_pdf_key', { length: 500 }).notNull(),
  extractionProvider: varchar('extraction_provider', { length: 50 }).notNull(),
  extractionModel: varchar('extraction_model', { length: 100 }).notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('bow_docs_grade_area_year_idx').on(t.gradeLevel, t.learningArea, t.schoolYear)]);
