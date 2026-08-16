CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_parent_run_idx" ON "runs" USING btree ("parent_run_id") WHERE parent_run_id is not null;--> statement-breakpoint
CREATE INDEX "runs_prune_idx" ON "runs" USING btree ("created_at") WHERE status not in ('running', 'queued');