CREATE TABLE "rate_limits" (
	"user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_user_id_bucket_window_start_pk" PRIMARY KEY("user_id","bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "trigger_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_slug" text NOT NULL,
	"composio_trigger_id" text,
	"connected_account_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text DEFAULT 'v1' NOT NULL,
	"last4" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"name" text,
	"image_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"workflow_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_toolkit_unique";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'disconnected';--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "pending_account_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "stale_account_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "auth_config_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "pending_nonce" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "pending_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_toolkits" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "connection_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_instances" ADD CONSTRAINT "trigger_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_provider_keys" ADD CONSTRAINT "user_provider_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_instances_user_slug_uniq" ON "trigger_instances" USING btree ("user_id","trigger_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_provider_keys_user_provider" ON "user_provider_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_toolkit_uniq" ON "connections" USING btree ("user_id","toolkit");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_account_uniq" ON "connections" USING btree ("composio_connected_account_id") WHERE composio_connected_account_id is not null;--> statement-breakpoint
CREATE INDEX "connections_user_status_idx" ON "connections" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "workflows_user_created_idx" ON "workflows" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "workflows_user_enabled_idx" ON "workflows" USING btree ("user_id","enabled");--> statement-breakpoint

-- Backfill: everything that exists today belongs to the single user this app
-- used to gate on. Seed `users` from every email already recorded, then point
-- the new ownership columns at it.
--
-- OWNER_EMAIL itself is not readable from here — drizzle-kit runs plain SQL
-- files — so a row whose `owner_email` was NULL (the column predates the
-- backfill) is picked up by `scripts/seed-owner.ts`, which runs straight after
-- `db:migrate` and can read the environment.
INSERT INTO "users" ("email")
SELECT DISTINCT lower("owner_email") FROM "workflows" WHERE "owner_email" IS NOT NULL
UNION
SELECT DISTINCT lower("email") FROM "user_settings"
ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE "workflows" w SET "user_id" = u."id"
  FROM "users" u WHERE lower(w."owner_email") = lower(u."email") AND w."user_id" IS NULL;--> statement-breakpoint

UPDATE "user_settings" s SET "user_id" = u."id"
  FROM "users" u WHERE lower(s."email") = lower(u."email") AND s."user_id" IS NULL;--> statement-breakpoint

-- The old `connections` table was dead code — declared, never read, never
-- written. Any row in it is therefore noise, and it has no owner to backfill.
DELETE FROM "connections" WHERE "user_id" IS NULL;