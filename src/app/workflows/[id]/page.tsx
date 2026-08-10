import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { updateWorkflow, deleteWorkflow } from "@/lib/actions";
import { WorkflowForm } from "@/components/workflow-form";
import type { DeliverTarget } from "@/lib/read-only";
import { requireOwner } from "@/lib/auth/require-owner";

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

  const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
  const deliverSlack = deliver.some((d) => d.type === "slack_dm");

  const boundUpdate = updateWorkflow.bind(null, id);
  const boundDelete = deleteWorkflow.bind(null, id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Edit {workflow.name}
        </h1>
        <form action={boundDelete}>
          <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:border-danger">
            Delete
          </button>
        </form>
      </div>

      <div className="mt-8">
        <WorkflowForm
          action={boundUpdate}
          submitLabel="Save changes"
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
    </main>
  );
}
