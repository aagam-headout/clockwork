ALTER TABLE "outputs" ADD COLUMN "delivery_log" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outputs" ADD COLUMN "unchanged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "finish_reason" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger_ref" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger_payload" jsonb;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "trigger_type" text DEFAULT 'cron' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "event_triggers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
-- Existing workflows have only a success timestamp; seed the attempt clock
-- from it so nothing looks due the moment this ships.
UPDATE "workflows" SET "last_attempt_at" = "last_run_at" WHERE "last_run_at" IS NOT NULL;--> statement-breakpoint
-- A run left behind by an older deploy would otherwise block its workflow
-- forever under the new one-active-run index.
UPDATE "runs" SET "status" = 'error', "error" = coalesce("error", 'released when the one-active-run index shipped'), "finished_at" = now() WHERE "status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_workflow" ON "runs" USING btree ("workflow_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "runs_trigger_ref_unique" ON "runs" USING btree ("trigger_ref") WHERE trigger_ref is not null;--> statement-breakpoint
CREATE INDEX "runs_workflow_created_idx" ON "runs" USING btree ("workflow_id","created_at");