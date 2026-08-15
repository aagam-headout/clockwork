ALTER TABLE "outputs" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;--> statement-breakpoint
CREATE INDEX "outputs_search_idx" ON "outputs" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "outputs_run_idx" ON "outputs" USING btree ("run_id");