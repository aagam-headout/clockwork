import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-950/50 text-emerald-400",
  error: "bg-red-950/40 text-red-400",
  running: "bg-blue-950/40 text-blue-400",
  queued: "bg-card text-muted",
};

export default async function RunsPage() {
  await requireOwner();

  const rows = await db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      startedAt: runs.startedAt,
      durationMs: runs.durationMs,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      workflowName: workflows.name,
    })
    .from(runs)
    .leftJoin(workflows, eq(runs.workflowId, workflows.id))
    .orderBy(desc(runs.createdAt))
    .limit(100);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-xl font-medium tracking-tight text-foreground">Runs</h1>
      <p className="mt-1 text-sm text-muted">Last {rows.length} runs across all workflows.</p>

      {rows.length === 0 && <p className="mt-10 text-sm text-muted">No runs yet.</p>}

      <ul className="mt-8 divide-y divide-border rounded-lg border border-border">
        {rows.map((run) => (
          <li key={run.id}>
            <Link
              href={`/runs/${run.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {run.workflowName ?? "(deleted workflow)"}
                  </span>
                  <span className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted">
                    {run.trigger}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {run.startedAt?.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
                  {run.inputTokens != null &&
                    run.outputTokens != null &&
                    ` · ${run.inputTokens + run.outputTokens} tokens`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[run.status] ?? STATUS_STYLES.queued}`}
              >
                {run.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
