import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { updateWorkflow, deleteWorkflow, runWorkflowNow } from "@/lib/actions";
import { WorkflowForm } from "@/components/workflow-form";
import { SubmitButton, ConfirmSubmitButton } from "@/components/submit-button";
import { Trash2, Play, ChevronRight, Globe, History, Zap } from "lucide-react";
import type { DeliverTarget } from "@/lib/read-only";
import { requireOwner } from "@/lib/auth/require-owner";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalog } from "@/lib/models";
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
  const [row] = await db
    .select({ name: workflows.name })
    .from(workflows)
    .where(eq(workflows.id, id));
  return { title: row?.name ?? "Workflow" };
}

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();

  const { id } = await params;
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!workflow) notFound();

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
    .where(eq(runs.workflowId, id))
    .orderBy(desc(runs.createdAt))
    .limit(5);

  const [availableToolkits, models] = await Promise.all([
    getConnectedToolkitOptions(),
    getModelCatalog(),
  ]);

  const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
  const slackChannel = deliver.find((d) => d.type === "slack_channel");
  const email = deliver.find((d) => d.type === "email");
  const webhook = deliver.find((d) => d.type === "webhook");

  const boundUpdate = updateWorkflow.bind(null, id);
  const boundDelete = deleteWorkflow.bind(null, id);

  return (
    <PageShell>
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
        <WorkflowForm
          action={boundUpdate}
          submitLabel="Save changes"
          availableToolkits={availableToolkits}
          models={models}
          defaultValues={{
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
                  {(run.startedAt ?? run.createdAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
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
    </PageShell>
  );
}
