import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { updateWorkflow, deleteWorkflow, runWorkflowNow } from "@/lib/actions";
import { EditWorkflowClient } from "@/components/edit-workflow-client";
import {
  EditAgentProvider,
  EditAgentButton,
} from "@/components/edit-agent-context";
import { SubmitButton, ConfirmSubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/local-time";
import {
  Trash2,
  Play,
  ChevronRight,
  Globe,
  History,
  Zap,
  Gauge,
  Wallet,
  GitBranch,
} from "lucide-react";
import type { DeliverTarget } from "@/lib/read-only";
import { currentUser, requireUser } from "@/lib/auth/user";
import {
  chainNeighbours,
  chainParentOptions,
  ownedWorkflow,
  ownedWorkflowOr404,
} from "@/lib/data/scope";
import { parseSignalSchema } from "@/lib/outcome/envelope";
import { signalTimeline } from "@/lib/data/digest-search";
import { checkCostCap, unpricedRunsThisMonth } from "@/lib/cost-cap";
import { formatUsd } from "@/lib/model-tiers";
import { SignalsChart } from "@/components/signals-chart";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalogForUser } from "@/lib/models";
import {
  Badge,
  Card,
  ButtonLink,
  ListBox,
  Mono,
  PageHeader,
  PageShell,
  SectionLabel,
  StatusDot,
  statusTone,
} from "@/components/ui";
import Link from "next/link";

/** How far back the signal sparklines look. */
const SIGNAL_WINDOW_DAYS = 90;

export const dynamic = "force-dynamic";
// "Run now" continues in `after()` after the action responds; the run needs
// the full window, bounded by this segment's maxDuration.
export const maxDuration = 300;

/*
 * Every tab said "Clockwork"; with a run, its workflow, and the list open,
 * telling tabs apart meant clicking. One query for the name is cheap next
 * to the page's own.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /*
   * Scoped like the page itself — `generateMetadata` runs independently of
   * the component, so unscoped it leaked another user's workflow name into
   * the tab title even when the page 404'd.
   */
  const user = await currentUser();
  const row = user ? await ownedWorkflow(id, user.id) : null;
  return { title: row?.name ?? "Workflow" };
}

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  const { id } = await params;
  // 404 for a workflow that isn't theirs, same as one that doesn't exist —
  // a distinct 403 would confirm the id belongs to someone.
  const workflow = await ownedWorkflowOr404(id, user.id);

  const recentRuns = await db
    .select({
      id: runs.id,
      status: runs.status,
      trigger: runs.trigger,
      startedAt: runs.startedAt,
      createdAt: runs.createdAt,
      durationMs: runs.durationMs,
    })
    .from(runs)
    // Already implied by the ownership check above; scoped anyway so the
    // query is correct on its own terms.
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(and(eq(runs.workflowId, id), eq(workflows.userId, user.id)))
    .orderBy(desc(runs.createdAt))
    .limit(5);

  const declaredSignals = parseSignalSchema(workflow.signalSchema);
  const cap = await checkCostCap(workflow);
  /*
   * `costUsd` is null when pricing was unavailable, and the sum treats those
   * as zero — so the total is a floor, and the page says so.
   */
  const hasUnpricedRun =
    cap.state !== "uncapped" &&
    (await unpricedRunsThisMonth(id, workflow.timezone)) > 0;

  const [availableToolkits, models, parentOptions, chain, signalPoints] =
    await Promise.all([
      getConnectedToolkitOptions(user.id),
      getModelCatalogForUser(user.id),
      // Excludes this workflow — it can't be its own parent, and offering
      // it would just error on save.
      chainParentOptions(user.id, id),
      chainNeighbours(user.id, id, workflow.parentWorkflowId),
      // Only worth the query when there is something to plot.
      declaredSignals.length > 0
        ? signalTimeline(user.id, id, SIGNAL_WINDOW_DAYS)
        : Promise.resolve([]),
    ]);

  const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
  const slackChannel = deliver.find((d) => d.type === "slack_channel");
  const email = deliver.find((d) => d.type === "email");
  const webhook = deliver.find((d) => d.type === "webhook");

  const boundUpdate = updateWorkflow.bind(null, id);
  const boundDelete = deleteWorkflow.bind(null, id);

  return (
    <PageShell>
      <EditAgentProvider>
        <PageHeader
          backHref="/workflows"
          backLabel="Workflows"
          title={workflow.name}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              {workflow.enabled ? (
                <Badge tone="success" dot>
                  enabled
                </Badge>
              ) : (
                <Badge tone="warn" dot>
                  paused
                </Badge>
              )}
              {/* Event workflows have an empty cron column; an empty code
                  chip read as a rendering bug. */}
              {workflow.triggerType === "event" ? (
                <Badge tone="neutral" icon={Zap}>
                  {workflow.eventTriggers.length} event
                  {workflow.eventTriggers.length === 1 ? "" : "s"}
                </Badge>
              ) : (
                <>
                  <Mono>{workflow.cron}</Mono>
                  <span className="text-subtle inline-flex items-center gap-1.5 text-xs">
                    <Globe className="h-3.5 w-3.5" />
                    {workflow.timezone}
                  </span>
                </>
              )}
            </span>
          }
          actions={
            <>
              <form
                action={async () => {
                  "use server";
                  await runWorkflowNow(id);
                }}
              >
                <SubmitButton
                  pendingLabel="Running…"
                  icon={<Play className="h-3.5 w-3.5" />}
                  variant="outline"
                  size="sm"
                >
                  Run now
                </SubmitButton>
              </form>
              <EditAgentButton />
              <form action={boundDelete}>
                <ConfirmSubmitButton
                  pendingLabel="Deleting…"
                  confirmLabel="Delete workflow?"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Delete workflow
                </ConfirmSubmitButton>
              </form>
            </>
          }
        />

        <div className="rise mt-6">
          <EditWorkflowClient
            action={boundUpdate}
            submitLabel="Save changes"
            availableToolkits={availableToolkits}
            models={models}
            initialValues={{
              name: workflow.name,
              goal: workflow.goal,
              triggerType:
                workflow.triggerType === "event" ||
                workflow.triggerType === "workflow"
                  ? workflow.triggerType
                  : "cron",
              cron: workflow.cron,
              timezone: workflow.timezone,
              eventTriggers: workflow.eventTriggers,
              model: workflow.model,
              maxSteps: workflow.maxSteps,
              readOnly: workflow.readOnly,
              toolkits: workflow.toolkits,
              allowTools: workflow.allowTools,
              denyTools: workflow.denyTools,
              deliverSlack: deliver.some((d) => d.type === "slack_dm"),
              deliverSlackChannel: Boolean(slackChannel),
              slackChannel:
                slackChannel?.type === "slack_channel"
                  ? slackChannel.channel
                  : "",
              deliverEmail: Boolean(email),
              emailTo: email?.type === "email" ? email.to : "",
              deliverWebhook: Boolean(webhook),
              webhookUrl: webhook?.type === "webhook" ? webhook.url : "",
              parentWorkflowId: workflow.parentWorkflowId ?? "",
              parentCondition: workflow.parentCondition ?? "",
              alertCondition: workflow.alertCondition ?? "",
              signalSchema: declaredSignals,
              monthlyCostCapUsd: workflow.monthlyCostCapUsd ?? "",
            }}
            parentOptions={parentOptions}
          />
        </div>

        {(chain.parent || chain.children.length > 0) && (
          <section className="rise mt-8">
            <SectionLabel icon={GitBranch}>Chain</SectionLabel>
            <Card className="divide-border divide-y">
              {chain.parent && (
                <div className="flex items-center gap-2 px-5 py-3 text-sm">
                  <span className="text-muted shrink-0">Runs after</span>
                  <Link
                    href={`/workflows/${chain.parent.id}`}
                    className="text-foreground truncate hover:underline"
                  >
                    {chain.parent.name}
                  </Link>
                </div>
              )}
              {chain.children.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="text-muted shrink-0">Then runs</span>
                  {chain.children.map((child) => (
                    <span
                      key={child.id}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Link
                        href={`/workflows/${child.id}`}
                        className="text-foreground truncate hover:underline"
                      >
                        {child.name}
                      </Link>
                      {!child.enabled && <Badge tone="warn">paused</Badge>}
                    </span>
                  ))}
                </div>
              )}
              {chain.children.length > 0 && (
                // Deleting a parent pauses its children — invisible here
                // unless said.
                <p className="text-subtle px-5 py-2.5 text-xs">
                  Deleting this workflow pauses the {chain.children.length}{" "}
                  {chain.children.length === 1 ? "workflow" : "workflows"} it
                  triggers.
                </p>
              )}
            </Card>
          </section>
        )}

        {cap.state !== "uncapped" && (
          <section className="rise mt-8">
            <SectionLabel icon={Wallet}>This month</SectionLabel>
            <Card className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-muted text-sm">
                  <span className="text-foreground font-mono tabular-nums">
                    {formatUsd(cap.spent)}
                  </span>{" "}
                  of {formatUsd(cap.cap ?? 0)}
                </span>
                {cap.state === "warn" && <Badge tone="warn">near budget</Badge>}
                {cap.state === "over" && (
                  <Badge tone="danger">budget spent</Badge>
                )}
              </div>
              {/* A bar, not just a number — the useful question is room
                  left, which a ratio answers at a glance. */}
              <div className="bg-surface-2 mt-3 h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full ${
                    cap.state === "over"
                      ? "bg-danger"
                      : cap.state === "warn"
                        ? "bg-warn"
                        : "bg-accent"
                  }`}
                  style={{
                    width: `${Math.min(100, (cap.spent / (cap.cap || 1)) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
              {hasUnpricedRun && (
                <p className="text-subtle mt-2 text-xs">
                  Some runs have no recorded price — this is a lower bound.
                </p>
              )}
            </Card>
          </section>
        )}

        {signalPoints.length > 1 && (
          <section className="rise mt-8">
            <SectionLabel icon={Gauge}>
              Signals over {SIGNAL_WINDOW_DAYS} days
            </SectionLabel>
            <SignalsChart declared={declaredSignals} points={signalPoints} />
          </section>
        )}

        {recentRuns.length > 0 && (
          <section className="mt-8">
            <SectionLabel
              icon={History}
              count={recentRuns.length}
              action={
                <ButtonLink href="/runs" variant="ghost" size="sm">
                  All runs
                </ButtonLink>
              }
            >
              Recent runs
            </SectionLabel>
            <ListBox>
              {recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="group hover:bg-surface-hover flex items-center gap-3 px-4 py-3 transition-colors"
                >
                  <StatusDot
                    tone={statusTone(run.status)}
                    live={run.status === "running"}
                  />
                  <span className="text-muted min-w-0 flex-1 truncate font-mono text-xs tabular-nums">
                    <LocalTime
                      value={run.startedAt ?? run.createdAt}
                      format="datetime"
                    />
                  </span>
                  {/* Duration in its own column keeps timestamps left-aligned
                      and numbers comparable. */}
                  <span className="text-subtle w-14 shrink-0 text-right font-mono text-[11px] tabular-nums">
                    {run.durationMs != null
                      ? `${(run.durationMs / 1000).toFixed(1)}s`
                      : ""}
                  </span>
                  <Badge tone="neutral">{run.trigger}</Badge>
                  <span className="flex w-[86px] shrink-0 justify-end">
                    <Badge
                      tone={statusTone(run.status)}
                      dot={run.status === "running"}
                    >
                      {run.status}
                    </Badge>
                  </span>
                  <ChevronRight className="text-subtle h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </ListBox>
          </section>
        )}
      </EditAgentProvider>
    </PageShell>
  );
}
