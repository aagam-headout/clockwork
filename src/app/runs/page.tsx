import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import { cardClass } from "@/lib/card-class";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-950/50 text-emerald-400",
  error: "bg-red-950/40 text-red-400",
  running: "bg-blue-950/40 text-blue-400",
  queued: "bg-chip text-muted",
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
    <main className="mx-auto max-w-4xl px-8 py-12">
      <h1 className="text-xl font-medium tracking-tight text-foreground">Runs</h1>
      <p className="mt-1 text-sm text-muted">
        {rows.length === 0 ? "Nothing has run yet" : `Last ${rows.length} runs across all workflows`}
      </p>

      {rows.length === 0 && (
        <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-muted">Runs show up here once a workflow fires.</p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {rows.map((run) => (
          <Link key={run.id} href={`/runs/${run.id}`} className={`block ${cardClass(true)}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {run.workflowName ?? "(deleted workflow)"}
                  </span>
                  <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] text-muted">
                    {run.trigger}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
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
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
