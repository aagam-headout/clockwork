import { and, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps } from "@/db/schema";
import { CHAIN_QUEUE_MAX_AGE_MS } from "@/lib/limits";

/*
 * Two retention windows, because a run holds two different kinds of data.
 *
 * `run_steps` is a debug trace: a full tool payload per step, truncated but
 * still bulky — worth keeping a few weeks, dead weight after that.
 *
 * `runs` and `outputs` are the memory. A digest is a narrow row, read by
 * history search and the agent's `history` tool — "is this the third month
 * in a row?" is unanswerable over a thirty-day window, which is all a single
 * retention setting used to leave behind.
 */
export const RUN_RETENTION_DAYS = Number(process.env.RUN_RETENTION_DAYS ?? 30);
export const OUTPUT_RETENTION_DAYS = Number(
  process.env.OUTPUT_RETENTION_DAYS ?? 365,
);

/**
 * Whether a run is old enough that `pruneOldRunSteps` will have taken its
 * trace, even though the run and its digest are kept.
 *
 * Lives here, not in the page that asks: a server component can't read the
 * clock during render without tripping React's purity rule, and this window
 * and the sweep enforcing it should never disagree.
 */
export function traceWindowPassed(createdAt: Date): boolean {
  if (!Number.isFinite(RUN_RETENTION_DAYS) || RUN_RETENTION_DAYS <= 0) {
    return false;
  }
  return createdAt.getTime() < Date.now() - RUN_RETENTION_DAYS * 86_400_000;
}

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
 * timeout, OOM) leaves a row that never finishes, blocking that workflow
 * forever via the one-active-run index.
 *
 * A `queued` chained run is the exception. It's not a failed claim but a
 * durable backlog entry waiting for tick budget, and under sustained load can
 * legitimately wait longer than the fifteen minutes that means "dead" for
 * every other queued row. It gets `CHAIN_QUEUE_MAX_AGE_MS` instead — wider,
 * but still bounded, since an abandoned chained row must eventually clear or
 * it blocks its workflow forever too.
 *
 * A `running` row is aged from `started_at`, not `created_at`. Those match
 * for a run claimed the instant it's inserted, but a chained run may sit
 * queued up to `CHAIN_QUEUE_MAX_AGE_MS` before the drain claims it — judged
 * on `created_at` it could look "stuck" on the tick it starts. Reaping a
 * still-running row is not cosmetic: flipping it to `error` releases
 * `runs_one_active_per_workflow`, letting a second run start alongside it.
 */
export async function reapStuckRuns(maxAgeMs = 15 * 60_000): Promise<number> {
  // One clock reading for both windows. Two calls to `Date.now()` can land on
  // different milliseconds, drifting the gap between cutoffs from the
  // configured difference — harmless in production, but the two windows
  // wouldn't be anchored to the same instant.
  const now = Date.now();
  const cutoff = new Date(now - maxAgeMs);
  const chainCutoff = new Date(now - CHAIN_QUEUE_MAX_AGE_MS);

  const reaped = await db
    .update(runs)
    .set({
      status: "error",
      error: "run never reported back — released by the reaper",
      finishedAt: new Date(),
    })
    .where(
      sql`(
        (
          ${runs.status} = 'running'
          and coalesce(${runs.startedAt}, ${runs.createdAt}) < ${cutoff}
        )
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
