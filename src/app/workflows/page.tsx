import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/db";
import { workflows, runs } from "@/db/schema";
import { toggleWorkflow, runWorkflowNow, deleteWorkflow } from "@/lib/actions";
import { requireUser } from "@/lib/auth/user";
import { SubmitButton, ConfirmSubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/local-time";
import {
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  Workflow,
  Clock,
  Globe,
  History,
} from "lucide-react";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  Mono,
  PageHeader,
  PageShell,
  StatusDot,
  iconButtonClass,
  statusTone,
} from "@/components/ui";
import { TOOLKIT_ICONS, TOOLKIT_LABELS } from "@/lib/toolkit-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflows" };

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

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{
    triggerError?: string;
    error?: string;
    done?: string;
  }>;
}) {
  const user = await requireUser();

  // `triggerError`: the save succeeded but Composio wouldn't register its event
  // triggers — the workflow exists and just never fires until that's fixed.
  // `error`: a row action (pause, delete, run now) failed outright.
  // `done`: a save, pause or delete that worked. Every one of these actions
  // ends in a redirect, and one that changes nothing on screen reads as a
  // no-op — so the successful paths say so too, not just the failing ones.
  const { triggerError, error, done } = await searchParams;

  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.userId, user.id))
    .orderBy(desc(workflows.createdAt));

  /*
   * Latest run per workflow.
   *
   * `DISTINCT ON` rather than "take 300 recent runs and reduce in JS": that
   * shortcut was already wrong for a busy account — 300 rows need not reach
   * every workflow's most recent run — and with more than one account it
   * would be reading across all of them to get there.
   */
  const latestRuns = await db
    .selectDistinctOn([runs.workflowId], {
      workflowId: runs.workflowId,
      status: runs.status,
      errorCode: runs.errorCode,
      errorToolkits: runs.errorToolkits,
    })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(eq(workflows.userId, user.id))
    .orderBy(runs.workflowId, desc(runs.createdAt));

  const latestByWorkflow = new Map(latestRuns.map((r) => [r.workflowId, r]));
  const latestStatusByWorkflow = new Map(
    latestRuns.map((r) => [r.workflowId, r.status]),
  );

  const enabledCount = rows.filter((w) => w.enabled).length;

  return (
    <PageShell>
      <PageHeader
        title="Workflows"
        subtitle="Scheduled agents that read your apps and report back."
        actions={
          rows.length === 0 ? undefined : (
            <>
              <Badge tone={enabledCount > 0 ? "success" : "neutral"} dot>
                {rows.length} total · {enabledCount} active
              </Badge>
              {/* Creating one was only reachable from the empty state and the
                  sidebar; the list itself is where you are when you want it. */}
              <ButtonLink
                href="/workflows/new"
                variant="primary"
                size="sm"
                icon={Plus}
              >
                New workflow
              </ButtonLink>
            </>
          )
        }
      />

      {error && (
        <div className="mt-6">
          <Alert tone="danger" title="That didn't work">
            {error}
          </Alert>
        </div>
      )}

      {done && !error && !triggerError && (
        <div className="mt-6">
          <Alert tone="success">{done}</Alert>
        </div>
      )}

      {triggerError && (
        <div className="mt-6">
          <Alert tone="warn" title="Saved, but event triggers didn't register">
            {triggerError}
          </Alert>
        </div>
      )}

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
                      {!wf.enabled && (
                        <Badge tone="warn">
                          {wf.pausedReason === "needs_reconnect"
                            ? "paused · needs reconnect"
                            : "paused"}
                        </Badge>
                      )}
                    </div>

                    <p className="text-muted mt-2 line-clamp-2 text-sm leading-relaxed">
                      {wf.goal}
                    </p>

                    {/*
                     * A connection problem is the one failure the user can
                     * actually fix from here, so it gets a line and a link
                     * rather than being folded into the status dot.
                     */}
                    {(() => {
                      const latest = latestByWorkflow.get(wf.id);
                      const blocked =
                        wf.pausedReason === "needs_reconnect"
                          ? wf.toolkits
                          : latest?.errorCode === "needs_reconnect"
                            ? latest.errorToolkits
                            : [];
                      if (blocked.length === 0) return null;
                      return (
                        <p className="text-warn-text mt-2 text-xs">
                          Needs a working connection to{" "}
                          {blocked
                            .map((tk) => TOOLKIT_LABELS[tk] ?? tk)
                            .join(", ")}{" "}
                          —{" "}
                          <Link
                            href="/connections"
                            className="underline underline-offset-2"
                          >
                            reconnect
                          </Link>
                          .
                        </p>
                      );
                    })()}

                    {/* Each toolkit carries its own glyph, so the row reads as
                        apps rather than as a wall of gray words. */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {wf.toolkits.map((tk) => (
                        <Badge key={tk} tone="neutral" icon={TOOLKIT_ICONS[tk]}>
                          {TOOLKIT_LABELS[tk] ?? tk}
                        </Badge>
                      ))}
                    </div>

                    {/* One icon per fact, all on the same 12px line — the
                        schedule, the last result, the zone. */}
                    <div className="text-subtle mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {!wf.enabled
                          ? "Paused"
                          : wf.triggerType === "event"
                            ? `Runs on ${wf.eventTriggers.join(", ") || "no events yet"}`
                            : next
                              ? `Next ${next}`
                              : "Invalid cron expression"}
                      </span>
                      {wf.lastRunAt && (
                        <span className="inline-flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5 shrink-0" />
                          <LocalTime
                            value={wf.lastRunAt}
                            format="datetime"
                            prefix="Last ran "
                          />
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        {wf.timezone}
                      </span>
                    </div>
                  </div>

                  {/* Primary action first, then the icon-only trio it is
                      separated from by a hairline — so "Run now" doesn't read
                      as one of four equal buttons. */}
                  <div className="flex shrink-0 items-center gap-1">
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

                    <span className="bg-border mx-1 h-5 w-px" aria-hidden />

                    {/* The card title links to the same place, but a title is
                        not where anyone looks for "change this" — the edit
                        affordance belongs in the action row with the rest. */}
                    <Link
                      href={`/workflows/${wf.id}`}
                      title="Edit workflow"
                      aria-label="Edit workflow"
                      className={iconButtonClass("ghost")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>

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
                      {/* Arms first: this takes the workflow and its whole run
                          history, and it used to be one click on a 32px
                          glyph sitting next to Pause. */}
                      <ConfirmSubmitButton
                        pendingLabel="Deleting…"
                        confirmLabel="Delete workflow?"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        title="Delete workflow"
                      >
                        Delete workflow
                      </ConfirmSubmitButton>
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
