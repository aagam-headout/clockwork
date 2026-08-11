-- Multi-user constraints.
--
-- Deliberately separate from 0003. 0003 is purely additive and safe to deploy
-- alongside code that predates it; this one tightens constraints and must run
-- only once every workflow actually has an owner.
--
-- If it aborts, run `pnpm db:seed-owner` (which can read OWNER_EMAIL, as a
-- plain .sql file cannot) and then `pnpm db:migrate` again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "workflows" WHERE "user_id" IS NULL) THEN
    RAISE EXCEPTION
      'Some workflows still have no owner. Run `pnpm db:seed-owner` first, then re-run migrations.';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workflows" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- Per-owner slug uniqueness. Created *before* the global constraint is
-- dropped, so there is never a moment with no uniqueness at all.
CREATE UNIQUE INDEX "workflows_user_slug_unique" ON "workflows" USING btree ("user_id","slug");--> statement-breakpoint
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_slug_unique";--> statement-breakpoint

CREATE INDEX "workflows_user_trigger_enabled_idx" ON "workflows" USING btree ("user_id","trigger_type","enabled");--> statement-breakpoint

-- Superseded by user_id; nothing has read it since 0003 shipped.
ALTER TABLE "workflows" DROP COLUMN "owner_email";
