CREATE TABLE IF NOT EXISTS "fuel_storage_content" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_key" varchar(32) DEFAULT 'default' NOT NULL,
  "capacity_date" varchar(32),
  "capacity_tons" varchar(64),
  "price_rows_json" text DEFAULT '[]' NOT NULL,
  "documents_json" text DEFAULT '[]' NOT NULL,
  "submit_email" varchar(255) DEFAULT 'airportsemey@mail.kz' NOT NULL,
  "contact_phone" varchar(64) DEFAULT '8 (7222) 36-00-33' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "fuel_storage_content_key_unique"
ON "fuel_storage_content" ("content_key");

INSERT INTO "fuel_storage_content" (
  "content_key",
  "capacity_date",
  "capacity_tons",
  "price_rows_json",
  "documents_json",
  "submit_email",
  "contact_phone"
)
VALUES (
  'default',
  '',
  '',
  '[{"name":"Услуги по хранению ГСМ","unit":"за 1 тн (тонна) за хранение ГСМ","price":"по запросу","sortOrder":0},{"name":"Приём авиатоплива на склад ГСМ и внутренняя перекачка","unit":"за 1 тн","price":"по запросу","sortOrder":1}]',
  '["Договор на поставку авиатоплива между поставщиком авиатоплива и авиакомпанией","Свидетельство о государственной регистрации (перерегистрации) юридического лица или свидетельство о регистрации индивидуального предпринимателя","Информация о запрашиваемых объёмах хранения, включая сроки и объёмы хранения","Сертификат качества авиационного топлива","Документ, подтверждающий происхождение авиационного топлива","Документ, подтверждающий право собственности на объём авиационного топлива, планируемого к хранению"]',
  'airportsemey@mail.kz',
  '8 (7222) 36-00-33'
)
ON CONFLICT ("content_key") DO NOTHING;
