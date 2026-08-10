"use client";

import { useState } from "react";
import {
  WorkflowForm,
  type WorkflowFormValues,
  type ToolkitOption,
} from "@/components/workflow-form";
import { WorkflowAgentChat } from "@/components/workflow-agent-chat";
import type { ModelInfo } from "@/lib/model-tiers";

export function NewWorkflowClient({
  action,
  availableToolkits,
  models,
}: {
  action: (formData: FormData) => void;
  availableToolkits: ToolkitOption[];
  models: ModelInfo[];
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
        availableToolkits={availableToolkits}
        models={models}
      />
    </div>
  );
}
