"use client";

import { useState } from "react";
import { WorkflowForm, type WorkflowFormValues } from "@/components/workflow-form";
import { WorkflowAgentChat } from "@/components/workflow-agent-chat";

export function NewWorkflowClient({
  action,
}: {
  action: (formData: FormData) => void;
}) {
  const [proposal, setProposal] = useState<WorkflowFormValues | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <WorkflowAgentChat onPropose={setProposal} />

      {/* Remounting on a new proposal is simpler and more robust than lifting
          every field into controlled state just for this one prefill path. */}
      <WorkflowForm
        key={proposal ? JSON.stringify(proposal) : "blank"}
        action={action}
        submitLabel="Create workflow"
        defaultValues={proposal ?? undefined}
      />
    </div>
  );
}
