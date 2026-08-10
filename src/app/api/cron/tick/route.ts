import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueWorkflows } from "@/lib/dispatcher";
import { pruneOldRuns, reapStuckRuns } from "@/lib/retention";

// GH Actions cron hits this every 5 minutes. Vercel Hobby cron scheduling is
// coarser/limited, so the *scheduler* lives in GH Actions (free, unlimited
// frequency on a private repo) and just calls this endpoint — Vercel stays
// the execution + dashboard runtime. See PLAN.md §2.
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

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Before dispatching: free any workflow whose previous run died without
  // reporting back, or it would stay blocked by the one-active-run index.
  const reaped = await reapStuckRuns();
  const results = await runDueWorkflows();
  const pruned = await pruneOldRuns();

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    reaped,
    pruned,
    results,
  });
}
