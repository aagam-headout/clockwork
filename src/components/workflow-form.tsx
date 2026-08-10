"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { buttonClass } from "@/components/ui";
import { ToolkitLogo } from "@/components/toolkit-logo";
import { ModelPicker } from "@/components/model-picker";
import type { ModelInfo } from "@/lib/model-tiers";
import { Check, Globe, Plus } from "lucide-react";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Weekdays 8am", value: "0 8 * * 1-5" },
  { label: "Daily 9am", value: "0 9 * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Fridays 5pm", value: "0 17 * * 5" },
];

/** Web search needs no auth, so it's always offered. */
const WEB_SEARCH = { slug: "composio_search", name: "Web search" };

export type ToolkitOption = { slug: string; name: string; logo?: string };

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
  availableToolkits = [],
  models = [],
}: {
  action: (formData: FormData) => void;
  defaultValues?: Partial<WorkflowFormValues>;
  submitLabel: string;
  /** Connected toolkits, straight from Composio — not a hardcoded list. */
  availableToolkits?: ToolkitOption[];
  /** Model catalog from AI Gateway; the picker refreshes it on open. */
  models?: ModelInfo[];
}) {
  const [selectedToolkits, setSelectedToolkits] = useState<Set<string>>(
    new Set(defaultValues?.toolkits ?? ["composio_search"])
  );
  const [cron, setCron] = useState(defaultValues?.cron ?? "0 8 * * 1-5");
  const [extraSlug, setExtraSlug] = useState("");
  // Slugs typed in by hand (e.g. an app connected in another tab) plus any the
  // workflow already had but that isn't currently connected — never drop those
  // silently on save.
  const [extraToolkits, setExtraToolkits] = useState<ToolkitOption[]>(() => {
    const known = new Set([...availableToolkits.map((t) => t.slug), WEB_SEARCH.slug]);
    return (defaultValues?.toolkits ?? [])
      .filter((slug) => !known.has(slug))
      .map((slug) => ({ slug, name: TOOLKIT_LABELS[slug] ?? slug }));
  });

  const options: ToolkitOption[] = [WEB_SEARCH, ...availableToolkits, ...extraToolkits];

  function toggleToolkit(toolkit: string) {
    setSelectedToolkits((prev) => {
      const next = new Set(prev);
      if (next.has(toolkit)) next.delete(toolkit);
      else next.add(toolkit);
      return next;
    });
  }

  function addExtraToolkit() {
    const slug = extraSlug.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!slug) return;
    if (!options.some((o) => o.slug === slug)) {
      setExtraToolkits((prev) => [...prev, { slug, name: TOOLKIT_LABELS[slug] ?? slug }]);
    }
    setSelectedToolkits((prev) => new Set(prev).add(slug));
    setExtraSlug("");
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-px overflow-hidden rounded-container border border-border bg-border"
    >
      <Section title="Basics">
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={defaultValues?.name}
            placeholder="morning-brief"
            className="input"
          />
        </Field>

        <Field label="Goal" hint="The entire prompt the agent runs on.">
          <textarea
            name="goal"
            required
            rows={5}
            defaultValue={defaultValues?.goal}
            placeholder="Check my calendar for today and my assigned GitHub issues. Summarize into a short digest. Flag any meeting conflicts."
            className="input font-mono text-[13px]"
          />
        </Field>
      </Section>

      <Section title="Schedule">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cron">
            <input
              name="cron"
              required
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className="input font-mono"
            />
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

        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setCron(preset.value)}
              className={`h-7 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors ${
                cron === preset.value
                  ? "border-foreground bg-surface-2 text-foreground"
                  : "border-border text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tools">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((toolkit) => {
            const on = selectedToolkits.has(toolkit.slug);
            return (
              <label
                key={toolkit.slug}
                className={`relative flex cursor-pointer items-center gap-2 rounded-control border px-2 py-1.5 text-[13px] font-medium transition-colors ${
                  on
                    ? "border-foreground bg-surface-2 text-foreground"
                    : "border-border text-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                <input
                  type="checkbox"
                  name="toolkits"
                  value={toolkit.slug}
                  checked={on}
                  onChange={() => toggleToolkit(toolkit.slug)}
                  className="sr-only"
                />
                {toolkit.slug === WEB_SEARCH.slug ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-subtle">
                    <Globe className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <ToolkitLogo slug={toolkit.slug} name={toolkit.name} logo={toolkit.logo} />
                )}
                <span className="truncate">{toolkit.name}</span>
                {on && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
              </label>
            );
          })}
        </div>

        {availableToolkits.length === 0 && (
          <p className="text-xs text-subtle">
            Only web search available —{" "}
            <Link href="/connections" className="text-accent-text underline underline-offset-2">
              connect an app
            </Link>
            .
          </p>
        )}

        <div className="flex items-center gap-2">
          <input
            value={extraSlug}
            onChange={(e) => setExtraSlug(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExtraToolkit();
              }
            }}
            placeholder="Add by slug — linear, jira…"
            className="input h-9"
            aria-label="Add a toolkit by slug"
          />
          <button
            type="button"
            onClick={addExtraToolkit}
            disabled={!extraSlug.trim()}
            className={buttonClass("outline", "sm")}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </Section>

      <Section title="Model">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            <ModelPicker defaultValue={defaultValues?.model} initialModels={models} />
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
      </Section>

      <Section title="Delivery">
        <div className="flex flex-col gap-2">
          <Checkbox checked disabled label="Dashboard" hint="Always on." />
          <Checkbox
            name="deliverSlack"
            defaultChecked={defaultValues?.deliverSlack}
            label="Slack DM"
            hint="Needs Slack connected."
          />
        </div>
      </Section>

      <div className="flex items-center justify-between gap-3 bg-bg-subtle px-5 py-4">
        <p className="text-xs text-subtle">Read-only — the agent never writes.</p>
        <FormSubmitButton>{submitLabel}</FormSubmitButton>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 bg-surface px-5 py-6 sm:grid-cols-[200px_1fr]">
      <div>
        <h2 className="heading-14 text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 hidden text-xs leading-relaxed text-subtle sm:block">{description}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function FormSubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-[13px] font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-subtle">{hint}</p>}
    </div>
  );
}

function Checkbox({
  label,
  hint,
  name,
  checked,
  defaultChecked,
  disabled,
}: {
  label: string;
  hint?: string;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-control border border-border px-3 py-2.5 transition-colors ${
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-border-strong"
      }`}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        readOnly={checked !== undefined}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--solid)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}
