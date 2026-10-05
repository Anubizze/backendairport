CREATE TABLE IF NOT EXISTS "partner_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "year" integer NOT NULL,
  "title_ru" varchar(255) NOT NULL,
  "title_kz" varchar(255),
  "title_en" varchar(255),
  "url" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_published" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "partner_documents_year_idx" ON "partner_documents" ("year" DESC, "sort_order" ASC);
