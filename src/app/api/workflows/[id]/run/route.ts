import { NextRequest, NextResponse, after } from "next/server";
import { enqueueRun, executeRun } from "@/lib/executor";
import { requireUserApi } from "@/lib/auth/user";
import { ownedWorkflow } from "@/lib/data/scope";

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
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  /*
   * 404 for a workflow that belongs to someone else, exactly as for one that
   * doesn't exist. This route previously answered 403 in that case, which
   * confirmed the id was real — enough to enumerate other accounts' workflows
   * from guessed uuids.
   */
  const workflow = await ownedWorkflow(id, auth.user.id);
  if (!workflow) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }

  const queued = await enqueueRun(id, "manual");
  if (queued.skipped) {
    return NextResponse.json(
      {
        status: "skipped",
        reason: queued.reason,
        error: queued.message,
        // The UI can always offer the next click rather than dead-ending on
        // an explanation the user can't act on.
        action: queued.action,
      },
      { status: 409 },
    );
  }

  after(() => executeRun(queued.runId));

  return NextResponse.json({ runId: queued.runId, status: "queued" });
}
