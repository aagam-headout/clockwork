"use client";

import { useState } from "react";
import {
  WorkflowForm,
  type WorkflowFormValues,
  type ToolkitOption,
  type ParentOption,
} from "@/components/workflow-form";
import { WorkflowAgentChat } from "@/components/workflow-agent-chat";
import { useEditAgent } from "@/components/edit-agent-context";
import type { ModelInfo } from "@/lib/model-tiers";
import type { WorkflowFormState } from "@/lib/actions";

/*
 * Opens on the plain editor — form alone, as before this component existed —
 * so editing one field stays one click instead of always paying for a chat
 * pane nobody asked for. The "Edit with agent" toggle (see
 * `edit-agent-context.tsx`) swaps in the two-pane layout: chat seeded with
 * the saved workflow on the left, form on the right. The form never remounts
 * on toggle (same element, same key), so switching views mid-edit keeps
 * whatever's half-typed.
 */
export function EditWorkflowClient({
  action,
  submitLabel,
  availableToolkits,
  models,
  parentOptions,
  initialValues,
}: {
  action: (
    state: WorkflowFormState,
    formData: FormData,
  ) => Promise<WorkflowFormState>;
  submitLabel: string;
  availableToolkits: ToolkitOption[];
  models: ModelInfo[];
  parentOptions: ParentOption[];
  initialValues: WorkflowFormValues;
}) {
  const [proposal, setProposal] = useState<Partial<WorkflowFormValues> | null>(
    null,
  );
  const { open: agentOpen } = useEditAgent();

  const form = (
    <WorkflowForm
      key={proposal ? JSON.stringify(proposal) : "saved"}
      action={action}
      submitLabel={submitLabel}
      defaultValues={proposal ?? initialValues}
      availableToolkits={availableToolkits}
      models={models}
      parentOptions={parentOptions}
      title={agentOpen ? "Workflow config" : undefined}
      fillHeight={agentOpen}
    />
  );

  if (!agentOpen) {
    return form;
  }

  return (
    // Fixed viewport-relative height, self-contained since the plain-editor
    // branch above needs no height, so the page wrapper can't own it either.
    <div className="relative grid h-[min(70vh,640px)] min-h-0 gap-5 overflow-clip max-lg:items-start lg:grid-cols-[minmax(0,1fr)_344px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
      <div className="h-[min(62vh,520px)] min-h-0 lg:h-full">
        <WorkflowAgentChat
          onPropose={setProposal}
          models={models}
          availableToolkits={availableToolkits}
          initialSpec={initialValues}
        />
      </div>

      {/* Falls back to `initialValues`, not `undefined`, so a field the
          proposal omits shows the saved value, not the form's blank default. */}
      <div className="min-h-0 lg:h-full">{form}</div>
    </div>
  );
}
