import Link from "next/link";
import { createWorkflow } from "@/lib/actions";
import { NewWorkflowClient } from "@/components/new-workflow-client";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  await requireOwner();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/workflows" className="text-xs text-muted hover:text-foreground">
        ← Workflows
      </Link>
      <h1 className="mt-2 text-xl font-medium tracking-tight text-foreground">New workflow</h1>
      <p className="mt-1 text-sm text-muted">
        Read-only for now — the agent can look things up and deliver a digest, nothing else.
      </p>

      <div className="mt-8">
        <NewWorkflowClient action={createWorkflow} />
      </div>
    </main>
  );
}
