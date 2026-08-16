/**
 * Finishes the multi-user backfill (migration 0003).
 *
 * The SQL backfill only works from emails already in the database — it can't
 * see `OWNER_EMAIL` (drizzle-kit runs plain `.sql` with no env access), and
 * `workflows.owner_email` has always been nullable, so pre-existing rows may
 * have no email to match at all.
 *
 * This script closes both gaps: ensures the owner has a `users` row, and
 * adopts every still-unowned workflow into it. Run after `pnpm db:migrate`,
 * before the migration that makes `workflows.user_id` NOT NULL:
 *
 *   pnpm db:migrate && pnpm db:seed-owner && pnpm db:migrate
 *
 * Idempotent: re-running is a no-op, and running after others sign up only
 * touches rows still unowned.
 *
 * Talks to Postgres directly instead of importing `@/db`: it runs under plain
 * Node as a deploy step, without the bundler's path aliasing or extensionless
 * resolution.
 */
import { Pool } from "pg";

async function main() {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("[seed-owner] DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    // Once the constraints migration has run, `user_id` is NOT NULL — nothing
    // left to adopt.
    const { rows: columns } = await pool.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_name = 'workflows' and column_name = 'user_id'`,
    );

    if (columns.length === 0) {
      console.error(
        "[seed-owner] workflows.user_id does not exist — run `pnpm db:migrate` first.",
      );
      process.exit(1);
    }

    const { rows: orphanRows } = await pool.query<{ count: string }>(
      `select count(*)::int as count from workflows where user_id is null`,
    );
    const orphans = Number(orphanRows[0]?.count ?? 0);

    if (orphans === 0) {
      console.log(
        "[seed-owner] nothing to do — every workflow already has an owner.",
      );
      return;
    }

    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!ownerEmail) {
      console.error(
        `[seed-owner] ${orphans} workflow(s) have no owner and OWNER_EMAIL is not set.\n` +
          `Set OWNER_EMAIL to the account those workflows belong to and re-run, ` +
          `or the constraints migration will refuse to apply.`,
      );
      process.exit(1);
    }

    /*
     * One transaction: a half-finished adoption would leave some workflows
     * owned and others not, with no way for the next run to tell which owner
     * the stragglers were meant to get.
     */
    const client = await pool.connect();
    try {
      await client.query("begin");

      // The email index is functional (lower(email)), so it can't be an ON
      // CONFLICT target by column — read-then-insert is fine since this
      // script is single-threaded.
      const { rows: existing } = await client.query<{ id: string }>(
        `select id from users where lower(email) = $1 limit 1`,
        [ownerEmail],
      );

      const ownerId =
        existing[0]?.id ??
        (
          await client.query<{ id: string }>(
            `insert into users (email, name) values ($1, 'Owner') returning id`,
            [ownerEmail],
          )
        ).rows[0].id;

      const adopted = await client.query(
        `update workflows set user_id = $1 where user_id is null`,
        [ownerId],
      );

      await client.query(
        `update user_settings set user_id = $1
          where lower(email) = $2 and user_id is null`,
        [ownerId, ownerEmail],
      );

      await client.query("commit");

      console.log(
        `[seed-owner] ${ownerEmail} → ${ownerId}; adopted ${adopted.rowCount} workflow(s).`,
      );
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed-owner] failed", err);
  process.exit(1);
});
