CREATE TYPE "public"."product_source" AS ENUM('manual', 'studio_generated');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "product_previews" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_version_id" integer NOT NULL,
	"r2_preview_key" varchar(500) NOT NULL,
	"mime_type" varchar(100) DEFAULT 'image/webp' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"version" integer NOT NULL,
	"source" "product_source" NOT NULL,
	"studio_job_id" varchar(255),
	"r2_key" varchar(500) NOT NULL,
	"version_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"grade_level" varchar(50) NOT NULL,
	"subject" varchar(100) NOT NULL,
	"term" varchar(100) NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bow_documents" (
	"content_hash" varchar(64) PRIMARY KEY NOT NULL,
	"grade_level" varchar(50) NOT NULL,
	"learning_area" varchar(100) NOT NULL,
	"school_year" varchar(20) NOT NULL,
	"r2_json_key" varchar(500) NOT NULL,
	"r2_pdf_key" varchar(500) NOT NULL,
	"extraction_provider" varchar(50) NOT NULL,
	"extraction_model" varchar(100) NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_previews" ADD CONSTRAINT "product_previews_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_grade_subject_term_idx" ON "products" USING btree ("grade_level","subject","term");--> statement-breakpoint
CREATE INDEX "bow_docs_grade_area_year_idx" ON "bow_documents" USING btree ("grade_level","learning_area","school_year");