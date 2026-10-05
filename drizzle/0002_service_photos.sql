CREATE TABLE IF NOT EXISTS "service_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_id" varchar(64) NOT NULL,
  "url" text NOT NULL,
  "alt_ru" varchar(255),
  "alt_kz" varchar(255),
  "alt_en" varchar(255),
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "service_photos_service_id_idx" ON "service_photos" ("service_id");
