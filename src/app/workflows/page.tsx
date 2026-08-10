import Link from "next/link";
import { desc } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/db";
import { workflows, runs } from "@/db/schema";
import { toggleWorkflow, runWorkflowNow, deleteWorkflow } from "@/lib/actions";
import { requireOwner } from "@/lib/auth/require-owner";
import { SubmitButton } from "@/components/submit-button";
import { PlusIcon, PlayIcon, PauseIcon, TrashIcon } from "@/components/icons";
import { cardClass } from "@/lib/card-class";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-success",
  error: "bg-danger",
  running: "bg-accent",
  queued: "bg-muted",
};

function nextRunAt(cron: string, timezone: string): string {
  try {
    const interval = CronExpressionParser.parse(cron, { tz: timezone });
    return interval.next().toDate().toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "invalid cron";
  }
}

export default async function WorkflowsPage() {
  await requireOwner();

  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));

  // One query, reduced in JS to "latest run per workflow" — simpler than a
  // window function and plenty fast at this scale (personal tool, low volume).
  const recentRuns = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(300);
  const latestStatusByWorkflow = new Map<string, string>();
  for (const run of recentRuns) {
    if (!latestStatusByWorkflow.has(run.workflowId)) {
      latestStatusByWorkflow.set(run.workflowId, run.status);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-8 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">Workflows</h1>
          <p className="mt-1 text-sm text-muted">
            {rows.length === 0 ? "None yet" : `${rows.length} configured`}
          </p>
        </div>
        <Link
          href="/workflows/new"
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New workflow
        </Link>
      </div>

      {rows.length === 0 && (
        <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-muted">
            Nothing configured yet.{" "}
            <Link href="/workflows/new" className="text-accent underline">
              Create your first workflow
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {rows.map((wf) => {
          const latestStatus = latestStatusByWorkflow.get(wf.id);
          return (
            <div key={wf.id} className={cardClass(true)}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {latestStatus && (
                      <span
                        title={`last run: ${latestStatus}`}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[latestStatus] ?? STATUS_DOT.queued}`}
                      />
                    )}
                    <Link
                      href={`/workflows/${wf.id}`}
                      className="truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {wf.name}
                    </Link>
                    <span className="rounded bg-chip px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {wf.cron}
                    </span>
                    {!wf.enabled && (
                      <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] text-muted">
                        paused
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {wf.toolkits.map((tk) => (
                      <span
                        key={tk}
                        className="rounded bg-chip px-1.5 py-0.5 text-[10px] text-muted"
                      >
                        {tk}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 truncate text-xs text-muted">
                    {wf.enabled ? `Next run: ${nextRunAt(wf.cron, wf.timezone)}` : "Disabled"}
                    {wf.lastRunAt &&
                      ` · Last ran: ${wf.lastRunAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <form
                    action={async () => {
                      "use server";
                      await runWorkflowNow(wf.id);
                    }}
                  >
                    <SubmitButton pendingLabel="Running…" icon={PlayIcon}>
                      Run now
                    </SubmitButton>
                  </form>

                  <form
                    action={async () => {
                      "use server";
                      await toggleWorkflow(wf.id, !wf.enabled);
                    }}
                  >
                    <SubmitButton pendingLabel="…" icon={wf.enabled ? PauseIcon : PlayIcon}>
                      {wf.enabled ? "Pause" : "Enable"}
                    </SubmitButton>
                  </form>

                  <form
                    action={async () => {
                      "use server";
                      await deleteWorkflow(wf.id);
                    }}
                  >
                    <SubmitButton pendingLabel="…" variant="danger" icon={TrashIcon}>
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
