import { and, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";

/**
 * Runs are a rolling log, not an archive: each one carries a full tool trace,
 * so an unbounded history is mostly dead jsonb. Steps and outputs are removed
 * with the run by the `on delete cascade` foreign keys.
 */
export const RUN_RETENTION_DAYS = Number(process.env.RUN_RETENTION_DAYS ?? 30);

/** Deletes finished runs older than the retention window. */
export async function pruneOldRuns(): Promise<number> {
  if (!Number.isFinite(RUN_RETENTION_DAYS) || RUN_RETENTION_DAYS <= 0) return 0;

  const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * 86_400_000);

  const deleted = await db
    .delete(runs)
    .where(
      and(
        lt(runs.createdAt, cutoff),
        // Never delete something still in flight, however old the row looks.
        ne(runs.status, "running"),
        ne(runs.status, "queued"),
      ),
    )
    .returning({ id: runs.id });

  return deleted.length;
}

/**
 * Releases runs stuck in `running` — a function killed mid-run (deploy,
 * timeout, OOM) leaves a row that never finishes, and the one-active-run
 * index would then block that workflow forever.
 */
export async function reapStuckRuns(maxAgeMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const reaped = await db
    .update(runs)
    .set({
      status: "error",
      error: "run never reported back — released by the reaper",
      finishedAt: new Date(),
    })
    .where(
      and(
        sql`${runs.status} in ('running', 'queued')`,
        lt(runs.createdAt, cutoff),
      ),
    )
    .returning({ id: runs.id });

  return reaped.length;
}
