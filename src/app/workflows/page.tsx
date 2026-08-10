import Link from "next/link";
import { desc } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { toggleWorkflow, runWorkflowNow, deleteWorkflow } from "@/lib/actions";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">Workflows</h1>
          <p className="mt-1 text-sm text-muted">{rows.length} configured</p>
        </div>
        <Link
          href="/workflows/new"
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
        >
          New workflow
        </Link>
      </div>

      {rows.length === 0 && (
        <p className="mt-10 text-sm text-muted">
          No workflows yet.{" "}
          <Link href="/workflows/new" className="text-accent underline">
            Create one
          </Link>
          .
        </p>
      )}

      <ul className="mt-8 divide-y divide-border rounded-lg border border-border">
        {rows.map((wf) => (
          <li key={wf.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/workflows/${wf.id}`}
                  className="truncate text-sm font-medium text-foreground hover:underline"
                >
                  {wf.name}
                </Link>
                <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  {wf.cron}
                </span>
                {!wf.enabled && (
                  <span className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted">
                    paused
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
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
                <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-foreground">
                  Run now
                </button>
              </form>

              <form
                action={async () => {
                  "use server";
                  await toggleWorkflow(wf.id, !wf.enabled);
                }}
              >
                <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-foreground">
                  {wf.enabled ? "Pause" : "Enable"}
                </button>
              </form>

              <form
                action={async () => {
                  "use server";
                  await deleteWorkflow(wf.id);
                }}
              >
                <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:border-danger">
                  Delete
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
