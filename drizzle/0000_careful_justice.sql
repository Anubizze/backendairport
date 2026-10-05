CREATE TYPE "public"."flight_direction" AS ENUM('arrival', 'departure');--> statement-breakpoint
CREATE TYPE "public"."flight_status" AS ENUM('scheduled', 'checkin', 'boarding', 'departed', 'delayed', 'cancelled', 'landing', 'landed', 'arrived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('superadmin', 'dispatcher', 'news_editor');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flight_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"previous_status" "flight_status",
	"new_status" "flight_status" NOT NULL,
	"changed_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flight_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" varchar(32) NOT NULL,
	"airline_name" varchar(120) NOT NULL,
	"airline_code" varchar(8) NOT NULL,
	"direction" "flight_direction" NOT NULL,
	"city" varchar(120) NOT NULL,
	"city_code" varchar(8) NOT NULL,
	"terminal" varchar(16) DEFAULT '1' NOT NULL,
	"sector" varchar(16),
	"gate" varchar(16),
	"scheduled_time" timestamp with time zone NOT NULL,
	"estimated_time" timestamp with time zone,
	"status" "flight_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"flight_id" uuid,
	"status_sent" "flight_status" NOT NULL,
	"channel" varchar(32) DEFAULT 'email' NOT NULL,
	"was_successful" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'dispatcher' NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flight_status_history" ADD CONSTRAINT "flight_status_history_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flight_status_history" ADD CONSTRAINT "flight_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flight_subscriptions" ADD CONSTRAINT "flight_subscriptions_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_subscription_id_flight_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."flight_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "flight_subscriptions_flight_email_unique" ON "flight_subscriptions" USING btree ("flight_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");