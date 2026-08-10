"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { TOOLKITS, type Toolkit } from "@/lib/toolkits";
import { cardClass } from "@/lib/card-class";

const TOOLKIT_LABELS: Record<Toolkit, string> = {
  googlecalendar: "Google Calendar",
  gmail: "Gmail",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
};

const MODELS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-haiku-4-5",
];

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Every weekday at 8am", value: "0 8 * * 1-5" },
  { label: "Every day at 9am", value: "0 9 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every Friday at 5pm", value: "0 17 * * 5" },
];

export type WorkflowFormValues = {
  name: string;
  goal: string;
  cron: string;
  timezone: string;
  model: string;
  maxSteps: number;
  toolkits: string[];
  deliverSlack: boolean;
};

export function WorkflowForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (formData: FormData) => void;
  defaultValues?: Partial<WorkflowFormValues>;
  submitLabel: string;
}) {
  const [selectedToolkits, setSelectedToolkits] = useState<Set<string>>(
    new Set(defaultValues?.toolkits ?? ["composio_search"])
  );

  function toggleToolkit(toolkit: string) {
    setSelectedToolkits((prev) => {
      const next = new Set(prev);
      if (next.has(toolkit)) next.delete(toolkit);
      else next.add(toolkit);
      return next;
    });
  }

  return (
    <form action={action} className={`flex flex-col gap-6 ${cardClass()}`}>
      <Field label="Name">
        <input
          name="name"
          required
          defaultValue={defaultValues?.name}
          placeholder="morning-brief"
          className="input"
        />
      </Field>

      <Field label="Goal" hint="Natural language — this is the whole prompt the agent runs on.">
        <textarea
          name="goal"
          required
          rows={4}
          defaultValue={defaultValues?.goal}
          placeholder="Check my calendar for today and my assigned Linear issues. Summarize into a short digest. Flag any conflicts."
          className="input font-mono text-[13px]"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Cron" hint="Standard 5-field cron.">
          <input
            name="cron"
            required
            list="cron-presets"
            defaultValue={defaultValues?.cron ?? "0 8 * * 1-5"}
            className="input font-mono"
          />
          <datalist id="cron-presets">
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value} label={p.label} />
            ))}
          </datalist>
        </Field>

        <Field label="Timezone">
          <input
            name="timezone"
            required
            defaultValue={defaultValues?.timezone ?? "Asia/Kolkata"}
            className="input font-mono"
          />
        </Field>
      </div>

      <Field label="Toolkits" hint="Only read tools from these are exposed to the agent.">
        <div className="flex flex-wrap gap-2">
          {TOOLKITS.map((toolkit) => (
            <label
              key={toolkit}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedToolkits.has(toolkit)
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              <input
                type="checkbox"
                name="toolkits"
                value={toolkit}
                checked={selectedToolkits.has(toolkit)}
                onChange={() => toggleToolkit(toolkit)}
                className="hidden"
              />
              {TOOLKIT_LABELS[toolkit]}
            </label>
          ))}
          <label
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedToolkits.has("composio_search")
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            <input
              type="checkbox"
              name="toolkits"
              value="composio_search"
              checked={selectedToolkits.has("composio_search")}
              onChange={() => toggleToolkit("composio_search")}
              className="hidden"
            />
            Web search (no auth)
          </label>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Model">
          <select name="model" defaultValue={defaultValues?.model ?? MODELS[0]} className="input">
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Max steps">
          <input
            type="number"
            name="maxSteps"
            min={1}
            max={30}
            defaultValue={defaultValues?.maxSteps ?? 15}
            className="input"
          />
        </Field>
      </div>

      <Field label="Delivery">
        <label className="flex cursor-not-allowed items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked disabled className="accent-foreground" />
          Dashboard (always on)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="deliverSlack"
            defaultChecked={defaultValues?.deliverSlack}
            className="accent-foreground"
          />
          Also DM me on Slack (requires Slack connected)
        </label>
      </Field>

      <FormSubmitButton>{submitLabel}</FormSubmitButton>
    </form>
  );
}

function FormSubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-fit cursor-pointer rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
