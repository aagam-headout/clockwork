import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueWorkflows } from "@/lib/dispatcher";
import { pruneOldRuns, reapStuckRuns } from "@/lib/retention";
import { reconcileStaleConnections } from "@/lib/reconcile";
import { pruneRateLimits } from "@/lib/rate-limit";

// Two schedulers can drive this endpoint, and both ship because neither covers
// every self-host:
//
//   - Vercel Cron (GET) — one vendor, no repo secrets, but Hobby is capped at
//     one run per day; per-minute cadence needs Pro. See vercel.json.
//   - GH Actions (POST) every 5 minutes — free at any frequency, so it's what a
//     Hobby-plan deploy uses. See .github/workflows/cron-tick.yml.
//
// Vercel Cron attaches `Authorization: Bearer $CRON_SECRET` itself, the same
// header the workflow sends, so one auth check serves both. The tick is
// idempotent — the one-active-run index makes a double fire a no-op — so
// running both schedulers at once is safe. POST also covers driving the tick by
// hand: the local compose ticker (`pnpm docker:tick`) and curl.
export const maxDuration = 300;

/** Constant-time compare, so a wrong secret leaks nothing through timing. */
function secretMatches(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

/** Runs a housekeeping step, reporting its failure instead of throwing it. */
async function settle<T>(
  label: string,
  step: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await step();
  } catch (err) {
    console.error(`[tick] ${label} failed`, err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(req: NextRequest) {
  return tick(req);
}

/** Vercel Cron invokes with GET; the body and auth are otherwise identical. */
export async function GET(req: NextRequest) {
  return tick(req);
}

async function tick(req: NextRequest) {
  if (!secretMatches(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Before dispatching: free any workflow whose previous run died without
  // reporting back, or it would stay blocked by the one-active-run index.
  // Housekeeping is best-effort — neither reaping nor pruning failing is a
  // reason to skip the dispatch this tick exists for.
  const reaped = await settle("reap", reapStuckRuns);

  /*
   * Reconcile *before* dispatching, so a token that was revoked overnight is
   * reflected in the connection gate on this same tick rather than costing a
   * round of failed runs first. Bounded per tick — see `reconcileStale`.
   */
  const reconciled = await settle("reconcile", () =>
    reconcileStaleConnections(),
  );

  const results = await runDueWorkflows();

  const pruned = await settle("prune", pruneOldRuns);
  const prunedLimits = await settle("prune-limits", pruneRateLimits);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    reaped,
    reconciled,
    pruned,
    prunedLimits,
    results,
  });
}
