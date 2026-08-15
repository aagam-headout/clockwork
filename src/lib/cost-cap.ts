import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { LIMITS } from "@/lib/limits";

/*
 * Month-to-date model spend for one workflow, against its own cap.
 *
 * The month boundary is computed in the WORKFLOW's timezone, not the app's and
 * not the host's. That column already exists and already drives scheduling, and
 * a budget that resets at the wrong midnight is a support ticket from someone
 * whose workflow paused a day early.
 *
 * Enforcement is retroactive by construction: a run's cost is only known from
 * `runs.costUsd` after it finishes, so a cap blocks the next run rather than
 * the one that crossed it. The overshoot is bounded by a single run.
 */

export type CapVerdict = {
  state: "uncapped" | "ok" | "warn" | "over";
  spent: number;
  cap: number | null;
};

/** How far a zone is ahead of UTC at a given instant, in milliseconds. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const wall = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(at)
      .replace(
        /(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/,
        "$3-$1-$2T$4:$5:$6Z",
      ),
  );
  return wall.getTime() - at.getTime();
}

/**
 * The instant the current calendar month began in `timezone`, as a real UTC
 * Date so it drops straight into a query comparison.
 *
 * Mirrors `startOfDay` in `src/lib/time.ts`: read the wall-clock parts in the
 * zone, guess the UTC instant for midnight on the first, then correct by the
 * zone's offset. One correction is enough — a DST shift moves a boundary by an
 * hour, never by a day.
 */
export function startOfMonthInZone(
  timezone: string,
  at: Date = new Date(),
): Date {
  let year: number;
  let month: number;

  try {
    const [y, m] = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    })
      .format(at)
      .split("-")
      .map(Number);
    year = y;
    month = m;
  } catch {
    /*
     * An unknown zone must not stop a run. UTC is the safe reading: its month
     * boundary is never later than any other zone's, so the window it produces
     * is the widest one — a cap can then only be enforced early, never late.
     */
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  }

  const guess = Date.UTC(year, month - 1, 1);
  return new Date(guess - zoneOffsetMs(timezone, new Date(guess)));
}

export function judgeCap(spent: number, cap: number | null): CapVerdict {
  if (cap === null || !Number.isFinite(cap) || cap <= 0) {
    return { state: "uncapped", spent, cap: null };
  }
  if (spent >= cap) return { state: "over", spent, cap };
  if (spent >= cap * LIMITS.costCapWarnRatio) {
    return { state: "warn", spent, cap };
  }
  return { state: "ok", spent, cap };
}

export async function monthToDateSpend(
  workflowId: string,
  timezone: string,
  at: Date = new Date(),
): Promise<number> {
  const since = startOfMonthInZone(timezone, at);

  const [row] = await db
    .select({
      /*
       * `costUsd` is null whenever pricing was unavailable for the model. Zero
       * is the only honest stand-in, and it makes the total a lower bound —
       * which the workflow page says out loud rather than hiding.
       */
      total: sql<string>`coalesce(sum(${runs.costUsd}), 0)`,
    })
    .from(runs)
    .where(and(eq(runs.workflowId, workflowId), gte(runs.createdAt, since)));

  return Number(row?.total ?? 0);
}

export async function checkCostCap(workflow: {
  id: string;
  timezone: string;
  monthlyCostCapUsd?: string | null;
}): Promise<CapVerdict> {
  const raw = workflow.monthlyCostCapUsd;
  /*
   * No cap, no query. The overwhelming majority of workflows are uncapped and
   * this sits on the hot path before every run — so the check has to cover
   * every shape an absent cap arrives in, not just `null`. A row selected
   * before this column existed hands back `undefined`, and `Number(undefined)`
   * is NaN, which is not `null` and would have bought a pointless query on
   * every run of every uncapped workflow.
   */
  const cap = raw === null || raw === undefined ? null : Number(raw);
  if (cap === null || !Number.isFinite(cap) || cap <= 0) {
    return { state: "uncapped", spent: 0, cap: null };
  }

  const spent = await monthToDateSpend(workflow.id, workflow.timezone);
  return judgeCap(spent, cap);
}
