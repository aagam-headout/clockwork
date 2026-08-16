import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createWorkflow } from "@/lib/actions";
import { NewWorkflowClient } from "@/components/new-workflow-client";
import { requireUser } from "@/lib/auth/user";
import { PageShell } from "@/components/ui";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalogForUser } from "@/lib/models";
import { chainParentOptions } from "@/lib/data/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "New workflow" };

export default async function NewWorkflowPage() {
  const user = await requireUser();

  const [availableToolkits, models, parentOptions] = await Promise.all([
    getConnectedToolkitOptions(user.id),
    getModelCatalogForUser(user.id),
    chainParentOptions(user.id),
  ]);

  return (
    // An app screen, not a document: on large viewports the page itself
    // doesn't scroll — chat and form scroll in their own panes, keeping the
    // composer and save bar reachable.
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
          parentOptions={parentOptions}
        />
      </div>
    </PageShell>
  );
}
