import { createWorkflow } from "@/lib/actions";
import { NewWorkflowClient } from "@/components/new-workflow-client";
import { requireOwner } from "@/lib/auth/require-owner";
import { PageHeader } from "@/components/ui";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalog } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  await requireOwner();

  const [availableToolkits, models] = await Promise.all([
    getConnectedToolkitOptions(),
    getModelCatalog(),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        backHref="/workflows"
        backLabel="Workflows"
        title="New workflow"
        subtitle="Describe the job in plain English, or fill the form yourself."
      />

      <div className="rise mt-6">
        <NewWorkflowClient
          action={createWorkflow}
          availableToolkits={availableToolkits}
          models={models}
        />
      </div>
    </main>
  );
}
