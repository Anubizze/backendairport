ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "price_rows_ru_json" text DEFAULT '[]' NOT NULL;

ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "price_rows_kz_json" text DEFAULT '[]' NOT NULL;

ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "price_rows_en_json" text DEFAULT '[]' NOT NULL;

ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "documents_ru_json" text DEFAULT '[]' NOT NULL;

ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "documents_kz_json" text DEFAULT '[]' NOT NULL;

ALTER TABLE "fuel_storage_content"
ADD COLUMN IF NOT EXISTS "documents_en_json" text DEFAULT '[]' NOT NULL;

UPDATE "fuel_storage_content"
SET
  "price_rows_ru_json" = CASE
    WHEN coalesce("price_rows_ru_json", '[]') = '[]' THEN coalesce("price_rows_json", '[]')
    ELSE "price_rows_ru_json"
  END,
  "price_rows_kz_json" = CASE
    WHEN coalesce("price_rows_kz_json", '[]') = '[]' THEN coalesce("price_rows_json", '[]')
    ELSE "price_rows_kz_json"
  END,
  "price_rows_en_json" = CASE
    WHEN coalesce("price_rows_en_json", '[]') = '[]' THEN coalesce("price_rows_json", '[]')
    ELSE "price_rows_en_json"
  END,
  "documents_ru_json" = CASE
    WHEN coalesce("documents_ru_json", '[]') = '[]' THEN coalesce("documents_json", '[]')
    ELSE "documents_ru_json"
  END,
  "documents_kz_json" = CASE
    WHEN coalesce("documents_kz_json", '[]') = '[]' THEN coalesce("documents_json", '[]')
    ELSE "documents_kz_json"
  END,
  "documents_en_json" = CASE
    WHEN coalesce("documents_en_json", '[]') = '[]' THEN coalesce("documents_json", '[]')
    ELSE "documents_en_json"
  END;
