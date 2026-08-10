import { createWorkflow } from "@/lib/actions";
import { NewWorkflowClient } from "@/components/new-workflow-client";
import { requireOwner } from "@/lib/auth/require-owner";
import { PageHeader, PageShell } from "@/components/ui";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalog } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata = { title: "New workflow" };

export default async function NewWorkflowPage() {
  await requireOwner();

  const [availableToolkits, models] = await Promise.all([
    getConnectedToolkitOptions(),
    getModelCatalog(),
  ]);

  return (
    // The builder is an app screen, not a document: on large viewports the page
    // itself doesn't scroll — the chat and the form each scroll in their own
    // pane, so the composer and the save bar are always reachable.
    <PageShell fill>
      <PageHeader
        backHref="/workflows"
        backLabel="Workflows"
        title="New workflow"
        subtitle="Describe the job in plain English, or fill the form yourself."
      />

      <div className="rise mt-6 min-h-0 lg:flex-1">
        <NewWorkflowClient
          action={createWorkflow}
          availableToolkits={availableToolkits}
          models={models}
        />
      </div>
    </PageShell>
  );
}
