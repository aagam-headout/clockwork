import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueWorkflows } from "@/lib/dispatcher";
import { pruneOldRunSteps, pruneOldRuns, reapStuckRuns } from "@/lib/retention";
import { reconcileStaleConnections } from "@/lib/reconcile";
import { pruneRateLimits } from "@/lib/rate-limit";

// Two schedulers drive this endpoint; both ship because neither covers every
// self-host:
//
//   - Vercel Cron (GET) — no repo secrets, but Hobby caps at one run/day;
//     per-minute needs Pro. See vercel.json.
//   - GH Actions (POST) every 5 minutes — free at any frequency, so it's what
//     Hobby deploys use. See .github/workflows/cron-tick.yml.
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, same header the
// workflow sends, so one auth check serves both. The tick is idempotent (the
// one-active-run index makes a double fire a no-op), so running both at once
// is safe. POST also covers manual ticks: the local compose ticker
// (`pnpm docker:tick`) and curl.
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
  // reporting back, or it stays blocked by the one-active-run index.
  // Housekeeping is best-effort — a reap or prune failure shouldn't skip the
  // dispatch this tick exists for.
  const reaped = await settle("reap", reapStuckRuns);

  /*
   * Reconcile *before* dispatching, so a token revoked overnight is reflected
   * in the connection gate this same tick, rather than costing a round of
   * failed runs first. Bounded per tick — see `reconcileStale`.
   */
  const reconciled = await settle("reconcile", () =>
    reconcileStaleConnections(),
  );

  const results = await runDueWorkflows();

  // Two sweeps, two windows: traces prune monthly, digests keep a year so
  // history search has something to search.
  const pruned = await settle("prune", pruneOldRuns);
  const prunedSteps = await settle("prune-steps", pruneOldRunSteps);
  const prunedLimits = await settle("prune-limits", pruneRateLimits);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    reaped,
    reconciled,
    pruned,
    prunedSteps,
    prunedLimits,
    results,
  });
}
