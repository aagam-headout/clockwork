ALTER TABLE "outputs" ADD COLUMN "signals" jsonb;--> statement-breakpoint
ALTER TABLE "outputs" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "outputs" ADD COLUMN "suppressed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outputs" ADD COLUMN "suppressed_reason" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "parent_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "parent_condition" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "alert_condition" text;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "signal_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_parent_fk" FOREIGN KEY ("parent_workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_queued_chained_idx" ON "runs" USING btree ("created_at") WHERE status = 'queued' and trigger = 'workflow';--> statement-breakpoint
CREATE INDEX "workflows_parent_idx" ON "workflows" USING btree ("parent_workflow_id");