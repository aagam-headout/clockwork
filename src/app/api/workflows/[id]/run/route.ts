import { NextRequest, NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun, executeRun } from "@/lib/executor";
import { isOwner } from "@/lib/auth/require-owner";

export const maxDuration = 300;

/*
 * "Run now" button in the dashboard. The response returns as soon as the run
 * row exists; the run itself continues in `after()`, so the caller gets a run
 * id to follow immediately instead of holding a request open for minutes.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isOwner())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [workflow] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!workflow) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }

  const queued = await enqueueRun(id, "manual");
  if (queued.skipped) {
    return NextResponse.json(
      { status: "skipped", reason: queued.reason },
      { status: 409 },
    );
  }

  after(() => executeRun(queued.runId));

  return NextResponse.json({ runId: queued.runId, status: "queued" });
}
