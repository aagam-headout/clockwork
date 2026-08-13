"use client";

import { useState } from "react";
import {
  WorkflowForm,
  type WorkflowFormValues,
  type ToolkitOption,
} from "@/components/workflow-form";
import { WorkflowAgentChat } from "@/components/workflow-agent-chat";
import { useEditAgent } from "@/components/edit-agent-context";
import type { ModelInfo } from "@/lib/model-tiers";
import type { WorkflowFormState } from "@/lib/actions";

/*
 * Opens on the plain editor — the form alone, same as before this component
 * existed — so editing one field stays a one-click flow instead of always
 * paying for a chat pane nobody asked for. The "Edit with agent" toggle in
 * the page header (see `edit-agent-context.tsx`) swaps in the new-workflow
 * screen's two-pane layout: chat on the left seeded with the saved workflow,
 * form on the right. The form itself never remounts on the toggle (same
 * element, same key), so switching views mid-edit doesn't drop whatever's
 * half-typed.
 */
export function EditWorkflowClient({
  action,
  submitLabel,
  availableToolkits,
  models,
  initialValues,
}: {
  action: (
    state: WorkflowFormState,
    formData: FormData,
  ) => Promise<WorkflowFormState>;
  submitLabel: string;
  availableToolkits: ToolkitOption[];
  models: ModelInfo[];
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
      title={agentOpen ? "Workflow config" : undefined}
      fillHeight={agentOpen}
    />
  );

  if (!agentOpen) {
    return form;
  }

  return (
    // Fixed viewport-relative height, self-contained rather than inherited
    // from the page — the plain-editor branch above needs no height at all,
    // so the page wrapper around this component can't own it either.
    <div className="relative grid h-[min(70vh,640px)] min-h-0 gap-5 overflow-clip max-lg:items-start lg:grid-cols-[minmax(0,1fr)_344px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
      <div className="h-[min(62vh,520px)] min-h-0 lg:h-full">
        <WorkflowAgentChat
          onPropose={setProposal}
          models={models}
          availableToolkits={availableToolkits}
          initialSpec={initialValues}
        />
      </div>

      {/* Falls back to `initialValues` (not `undefined`) on remount, so a
          field the proposal doesn't mention still shows the saved value, not
          the form's own blank default. */}
      <div className="min-h-0 lg:h-full">{form}</div>
    </div>
  );
}
