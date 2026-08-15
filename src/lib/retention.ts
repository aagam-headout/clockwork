import { and, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps } from "@/db/schema";
import { CHAIN_QUEUE_MAX_AGE_MS } from "@/lib/limits";

/*
 * Two retention windows, because a run holds two different kinds of data.
 *
 * `run_steps` is a debug trace: a full tool payload per step, truncated but
 * still bulky, worth having for a few weeks and dead weight after that.
 *
 * `runs` and `outputs` are the memory. A digest is a narrow row, and it is what
 * the history search and the agent's `history` tool read — "is this the third
 * month in a row?" is unanswerable over a thirty-day window, which is all a
 * single retention setting used to leave behind.
 */
export const RUN_RETENTION_DAYS = Number(process.env.RUN_RETENTION_DAYS ?? 30);
export const OUTPUT_RETENTION_DAYS = Number(
  process.env.OUTPUT_RETENTION_DAYS ?? 365,
);

/**
 * Drops the tool trace of runs past the shorter window, leaving the run row
 * and its digest in place.
 */
export async function pruneOldRunSteps(): Promise<number> {
  if (!Number.isFinite(RUN_RETENTION_DAYS) || RUN_RETENTION_DAYS <= 0) return 0;

  const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * 86_400_000);

  const deleted = await db
    .delete(runSteps)
    .where(
      sql`${runSteps.runId} in (
        select ${runs.id} from ${runs}
        where ${runs.createdAt} < ${cutoff}
          and ${runs.status} not in ('running', 'queued')
      )`,
    )
    .returning({ id: runSteps.id });

  return deleted.length;
}

/**
 * Deletes finished runs, and the digests cascading from them, once they are
 * past the longer window.
 */
export async function pruneOldRuns(): Promise<number> {
  if (!Number.isFinite(OUTPUT_RETENTION_DAYS) || OUTPUT_RETENTION_DAYS <= 0) {
    return 0;
  }

  const cutoff = new Date(Date.now() - OUTPUT_RETENTION_DAYS * 86_400_000);

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
 *
 * A `queued` chained run is the exception. It is not a claim that failed; it
 * is a durable backlog entry waiting for tick budget, and under sustained load
 * it can legitimately wait longer than the fifteen minutes that means "dead"
 * for every other queued row. It gets `CHAIN_QUEUE_MAX_AGE_MS` instead — wider,
 * but still bounded, because an abandoned chained row must eventually clear or
 * the one-active-run index blocks its workflow forever too.
 */
export async function reapStuckRuns(maxAgeMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const chainCutoff = new Date(Date.now() - CHAIN_QUEUE_MAX_AGE_MS);

  const reaped = await db
    .update(runs)
    .set({
      status: "error",
      error: "run never reported back — released by the reaper",
      finishedAt: new Date(),
    })
    .where(
      sql`(
        (${runs.status} = 'running' and ${runs.createdAt} < ${cutoff})
        or (
          ${runs.status} = 'queued'
          and ${runs.trigger} <> 'workflow'
          and ${runs.createdAt} < ${cutoff}
        )
        or (
          ${runs.status} = 'queued'
          and ${runs.trigger} = 'workflow'
          and ${runs.createdAt} < ${chainCutoff}
        )
      )`,
    )
    .returning({ id: runs.id });

  return reaped.length;
}
