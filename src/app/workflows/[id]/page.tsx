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
import { Trash2, Play, ChevronRight, Globe, History, Zap } from "lucide-react";
import type { DeliverTarget } from "@/lib/read-only";
import { currentUser, requireUser } from "@/lib/auth/user";
import { ownedWorkflow, ownedWorkflowOr404 } from "@/lib/data/scope";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalogForUser } from "@/lib/models";
import {
  Badge,
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

export const dynamic = "force-dynamic";
// "Run now" continues in `after()` after the action responds; the run itself
// needs the full window, and `after` work is bounded by this segment's limit.
export const maxDuration = 300;

/*
 * Every tab in this app said "Clockwork". With three of them open — a run, the
 * workflow it belongs to, the list — the only way to tell them apart was to
 * click. One query for the name is cheap next to the page's own.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /*
   * Scoped like the page itself. `generateMetadata` runs independently of the
   * component, so leaving it unscoped leaked another user's workflow name into
   * the browser tab title even though the page below it 404'd.
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
  // 404 for a workflow that isn't theirs, identical to one that doesn't exist
  // — a distinguishable 403 would confirm the id belongs to someone.
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
    // Already implied by the ownership check above; scoped anyway so the query
    // is correct on its own terms rather than by reading the lines above it.
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(and(eq(runs.workflowId, id), eq(workflows.userId, user.id)))
    .orderBy(desc(runs.createdAt))
    .limit(5);

  const [availableToolkits, models] = await Promise.all([
    getConnectedToolkitOptions(user.id),
    getModelCatalogForUser(user.id),
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
              {/* An event workflow has an empty cron column; showing it as an
                  empty code chip read as a rendering bug. */}
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
              triggerType: workflow.triggerType === "event" ? "event" : "cron",
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
            }}
          />
        </div>

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
                  {/* Duration in its own column so the timestamps above it stay
                      left-aligned and the numbers stay comparable. */}
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
