ALTER TABLE "outputs" ADD COLUMN "delivery_status" text DEFAULT 'delivered' NOT NULL;--> statement-breakpoint
ALTER TABLE "outputs" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "monthly_cost_cap_usd" numeric(10, 2);--> statement-breakpoint
CREATE INDEX "outputs_delivery_retry_idx" ON "outputs" USING btree ("created_at") WHERE delivery_status in ('pending', 'partial', 'failed');