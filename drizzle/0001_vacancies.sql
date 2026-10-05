CREATE TABLE IF NOT EXISTS "vacancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(255) NOT NULL,
  "department" varchar(120) NOT NULL,
  "employment_type" varchar(64) DEFAULT 'Полная занятость' NOT NULL,
  "salary_text" varchar(128) NOT NULL,
  "description" text,
  "contact_phone" varchar(32) DEFAULT '87222360033' NOT NULL,
  "is_published" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "vacancy_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vacancy_id" uuid NOT NULL,
  "full_name" varchar(255) NOT NULL,
  "phone" varchar(32) NOT NULL,
  "email" varchar(255),
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "vacancy_applications" ADD CONSTRAINT "vacancy_applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
