CREATE TABLE "user_settings" (
	"email" text PRIMARY KEY NOT NULL,
	"model_provider" text DEFAULT 'gateway' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "owner_email" text;