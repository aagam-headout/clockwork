import Link from "next/link";
import { desc } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/db";
import { workflows, runs } from "@/db/schema";
import { toggleWorkflow, runWorkflowNow, deleteWorkflow } from "@/lib/actions";
import { requireOwner } from "@/lib/auth/require-owner";
import { SubmitButton } from "@/components/submit-button";
import { Plus, Play, Pause, Trash2, Workflow, Clock } from "lucide-react";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  Mono,
  PageHeader,
  PageShell,
  StatusDot,
  statusTone,
} from "@/components/ui";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";

export const dynamic = "force-dynamic";
// The "Run now" action finishes its work in `after()`; that work is bounded
// by this segment's duration limit.
export const maxDuration = 300;

function nextRunAt(cron: string, timezone: string): string | null {
  try {
    const interval = CronExpressionParser.parse(cron, { tz: timezone });
    return interval.next().toDate().toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}

export default async function WorkflowsPage() {
  await requireOwner();

  const rows = await db
    .select()
    .from(workflows)
    .orderBy(desc(workflows.createdAt));

  // One query, reduced in JS to "latest run per workflow" — simpler than a
  // window function and plenty fast at this scale (personal tool, low volume).
  const recentRuns = await db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .limit(300);
  const latestStatusByWorkflow = new Map<string, string>();
  for (const run of recentRuns) {
    if (!latestStatusByWorkflow.has(run.workflowId)) {
      latestStatusByWorkflow.set(run.workflowId, run.status);
    }
  }

  const enabledCount = rows.filter((w) => w.enabled).length;

  return (
    <PageShell>
      <PageHeader
        title="Workflows"
        subtitle="Scheduled agents that read your apps and report back."
        actions={
          rows.length === 0 ? undefined : (
            <Badge tone={enabledCount > 0 ? "success" : "warn"} dot>
              {rows.length} total · {enabledCount} active
            </Badge>
          )
        }
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description="A goal in plain English plus a schedule."
            action={
              <ButtonLink href="/workflows/new" variant="primary" icon={Plus}>
                Create your first workflow
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {rows.map((wf) => {
            const latestStatus = latestStatusByWorkflow.get(wf.id);
            const next =
              wf.enabled && wf.triggerType !== "event"
                ? nextRunAt(wf.cron, wf.timezone)
                : null;
            return (
              <Card key={wf.id} interactive className="rise p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {latestStatus && (
                        <span
                          title={`Last run: ${latestStatus}`}
                          className="flex items-center"
                        >
                          <StatusDot
                            tone={statusTone(latestStatus)}
                            live={latestStatus === "running"}
                          />
                        </span>
                      )}
                      <Link
                        href={`/workflows/${wf.id}`}
                        className="heading-16 text-foreground truncate hover:underline"
                      >
                        {wf.name}
                      </Link>
                      <Mono>
                        {wf.triggerType === "event"
                          ? `${wf.eventTriggers.length} event${wf.eventTriggers.length === 1 ? "" : "s"}`
                          : wf.cron}
                      </Mono>
                      {!wf.enabled && <Badge tone="warn">paused</Badge>}
                    </div>

                    <p className="text-muted mt-2 line-clamp-2 text-sm leading-relaxed">
                      {wf.goal}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {wf.toolkits.map((tk) => (
                        <Badge key={tk} tone="neutral">
                          {TOOLKIT_LABELS[tk] ?? tk}
                        </Badge>
                      ))}
                    </div>

                    <div className="text-subtle mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {!wf.enabled
                          ? "Paused"
                          : wf.triggerType === "event"
                            ? `Runs on ${wf.eventTriggers.join(", ") || "no events yet"}`
                            : next
                              ? `Next ${next}`
                              : "Invalid cron expression"}
                      </span>
                      {wf.lastRunAt && (
                        <span>
                          Last ran{" "}
                          {wf.lastRunAt.toLocaleString("en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                      <span className="font-mono">{wf.timezone}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <form
                      action={async () => {
                        "use server";
                        await runWorkflowNow(wf.id);
                      }}
                    >
                      <SubmitButton
                        pendingLabel="Running…"
                        icon={<Play className="h-3.5 w-3.5" />}
                        variant="outline"
                      >
                        Run now
                      </SubmitButton>
                    </form>

                    <form
                      action={async () => {
                        "use server";
                        await toggleWorkflow(wf.id, !wf.enabled);
                      }}
                    >
                      <SubmitButton
                        pendingLabel="…"
                        icon={
                          wf.enabled ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )
                        }
                        variant="ghost"
                        iconOnly
                        title={
                          wf.enabled ? "Pause schedule" : "Enable schedule"
                        }
                      >
                        {wf.enabled ? "Pause" : "Enable"}
                      </SubmitButton>
                    </form>

                    <form
                      action={async () => {
                        "use server";
                        await deleteWorkflow(wf.id);
                      }}
                    >
                      <SubmitButton
                        pendingLabel="…"
                        variant="ghost"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        iconOnly
                        danger
                        title="Delete workflow"
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
