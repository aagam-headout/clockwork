import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createWorkflow } from "@/lib/actions";
import { NewWorkflowClient } from "@/components/new-workflow-client";
import { requireUser } from "@/lib/auth/user";
import { PageShell } from "@/components/ui";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalogForUser } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata = { title: "New workflow" };

export default async function NewWorkflowPage() {
  const user = await requireUser();

  const [availableToolkits, models] = await Promise.all([
    getConnectedToolkitOptions(user.id),
    getModelCatalogForUser(user.id),
  ]);

  return (
    // The builder is an app screen, not a document: on large viewports the page
    // itself doesn't scroll — the chat and the form each scroll in their own
    // pane, so the composer and the save bar are always reachable.
    <PageShell fill>
      <Link
        href="/workflows"
        className="rise text-muted hover:text-foreground inline-flex items-center gap-1.5 text-[13px] transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Workflows
        <span className="text-subtle">/</span>
        <span className="text-foreground">New</span>
      </Link>

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
