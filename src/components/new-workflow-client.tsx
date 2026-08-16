"use client";

import { useState } from "react";
import {
  WorkflowForm,
  type WorkflowFormValues,
  type ToolkitOption,
  type ParentOption,
} from "@/components/workflow-form";
import { WorkflowAgentChat } from "@/components/workflow-agent-chat";
import type { ModelInfo } from "@/lib/model-tiers";
import type { WorkflowFormState } from "@/lib/actions";

/*
 * Two panes: the conversation on the left writes the form on the right. Chat
 * is primary — describing the job is the fast path, the form is where you
 * correct it — so it takes the flexible column while settings sit in a
 * narrow fixed rail (344–380px). Each pane scrolls independently; below `lg`
 * they stack, chat first.
 */
export function NewWorkflowClient({
  action,
  availableToolkits,
  models,
  parentOptions,
}: {
  action: (
    state: WorkflowFormState,
    formData: FormData,
  ) => Promise<WorkflowFormState>;
  availableToolkits: ToolkitOption[];
  models: ModelInfo[];
  parentOptions: ParentOption[];
}) {
  const [proposal, setProposal] = useState<Partial<WorkflowFormValues> | null>(
    null,
  );

  return (
    // Rail is fixed, not a fraction: settings has a natural width, and chat
    // should absorb everything else.
    <div className="grid h-full min-h-0 gap-5 max-lg:items-start lg:grid-cols-[minmax(0,1fr)_344px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
      <div className="h-[min(62vh,520px)] min-h-0 lg:h-full">
        <WorkflowAgentChat
          onPropose={setProposal}
          models={models}
          availableToolkits={availableToolkits}
        />
      </div>

      {/* Card frame is fixed; scroll lives inside it (fillHeight), so header
          and save bar never move. Remounting on a new proposal is simpler
          than lifting every field into controlled state for this one prefill
          path. */}
      <div className="min-h-0 lg:h-full">
        <WorkflowForm
          key={proposal ? JSON.stringify(proposal) : "blank"}
          action={action}
          submitLabel="Create workflow"
          defaultValues={proposal ?? undefined}
          availableToolkits={availableToolkits}
          models={models}
          parentOptions={parentOptions}
          title="Workflow config"
          fillHeight
        />
      </div>
    </div>
  );
}
