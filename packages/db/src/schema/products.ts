import { pgTable, serial, text, varchar, timestamp, pgEnum, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const productStatus = pgEnum('product_status', ['draft', 'published', 'archived']);
export const productSource = pgEnum('product_source', ['manual', 'studio_generated']);

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  gradeLevel: varchar('grade_level', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 100 }).notNull(),
  term: varchar('term', { length: 100 }).notNull(),
  status: productStatus('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('products_grade_subject_term_idx').on(t.gradeLevel, t.subject, t.term)]);

export const productVersions = pgTable('product_versions', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  source: productSource('source').notNull(),
  studioJobId: varchar('studio_job_id', { length: 255 }),
  r2Key: varchar('r2_key', { length: 500 }).notNull(),
  versionNote: text('version_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productPreviews = pgTable('product_previews', {
  id: serial('id').primaryKey(),
  productVersionId: integer('product_version_id').notNull().references(() => productVersions.id, { onDelete: 'cascade' }),
  r2PreviewKey: varchar('r2_preview_key', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull().default('image/webp'),
});

export const productsRelations = relations(products, ({ many }) => ({ versions: many(productVersions) }));
export const productVersionsRelations = relations(productVersions, ({ one, many }) => ({
  product: one(products, { fields: [productVersions.productId], references: [products.id] }),
  previews: many(productPreviews),
}));
