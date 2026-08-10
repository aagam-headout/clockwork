import { createWorkflow } from "@/lib/actions";
import { WorkflowForm } from "@/components/workflow-form";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  await requireOwner();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-medium tracking-tight text-foreground">New workflow</h1>
      <p className="mt-1 text-sm text-muted">
        Read-only for now — the agent can look things up and deliver a digest, nothing else.
      </p>

      <div className="mt-8">
        <WorkflowForm action={createWorkflow} submitLabel="Create workflow" />
      </div>
    </main>
  );
}
