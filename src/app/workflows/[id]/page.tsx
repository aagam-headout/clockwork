import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { updateWorkflow, deleteWorkflow, runWorkflowNow } from "@/lib/actions";
import { WorkflowForm } from "@/components/workflow-form";
import { SubmitButton } from "@/components/submit-button";
import { Trash2, Play, ChevronRight } from "lucide-react";
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
  SectionLabel,
  StatusDot,
  statusTone,
} from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();

  const { id } = await params;
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
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
  const deliverSlack = deliver.some((d) => d.type === "slack_dm");

  const boundUpdate = updateWorkflow.bind(null, id);
  const boundDelete = deleteWorkflow.bind(null, id);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        backHref="/workflows"
        backLabel="Workflows"
        title={workflow.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Mono>{workflow.cron}</Mono>
            <span className="text-subtle">{workflow.timezone}</span>
            {workflow.enabled ? (
              <Badge tone="success">enabled</Badge>
            ) : (
              <Badge tone="warn">paused</Badge>
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
              <SubmitButton pendingLabel="Running…" icon={Play} variant="outline" size="sm">
                Run now
              </SubmitButton>
            </form>
            <form action={boundDelete}>
              <SubmitButton
                pendingLabel="Deleting…"
                variant="ghost"
                size="sm"
                icon={Trash2}
                danger
              >
                Delete
              </SubmitButton>
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
            cron: workflow.cron,
            timezone: workflow.timezone,
            model: workflow.model,
            maxSteps: workflow.maxSteps,
            toolkits: workflow.toolkits,
            deliverSlack,
          }}
        />
      </div>

      {recentRuns.length > 0 && (
        <section className="mt-10">
          <SectionLabel
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
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <StatusDot tone={statusTone(run.status)} live={run.status === "running"} />
                <span className="flex-1 truncate font-mono text-xs text-muted">
                  {(run.startedAt ?? run.createdAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
                </span>
                <Badge tone="neutral">{run.trigger}</Badge>
                <ChevronRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </ListBox>
        </section>
      )}
    </main>
  );
}
