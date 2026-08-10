import { NextRequest, NextResponse } from "next/server";
import { runDueWorkflows } from "@/lib/dispatcher";

// GH Actions cron hits this every 5 minutes. Vercel Hobby cron scheduling is
// coarser/limited, so the *scheduler* lives in GH Actions (free, unlimited
// frequency on a private repo) and just calls this endpoint — Vercel stays
// the execution + dashboard runtime. See PLAN.md §2.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await runDueWorkflows();
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
