"use client";

import { useEffect, useState } from "react";
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

export type TriggerTypeOption = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
};

export type WorkflowFormValues = {
  name: string;
  goal: string;
  triggerType: "cron" | "event";
  cron: string;
  timezone: string;
  eventTriggers: string[];
  model: string;
  maxSteps: number;
  toolkits: string[];
  allowTools: string[];
  denyTools: string[];
  deliverSlack: boolean;
  deliverSlackChannel: boolean;
  slackChannel: string;
  deliverEmail: boolean;
  emailTo: string;
  deliverWebhook: boolean;
  webhookUrl: string;
};

export function WorkflowForm({
  action,
  defaultValues,
  submitLabel,
  availableToolkits = [],
  models = [],
  fillHeight = false,
}: {
  action: (formData: FormData) => void;
  defaultValues?: Partial<WorkflowFormValues>;
  submitLabel: string;
  /** Connected toolkits, straight from Composio — not a hardcoded list. */
  availableToolkits?: ToolkitOption[];
  /** Model catalog from AI Gateway; the picker refreshes it on open. */
  models?: ModelInfo[];
  /**
   * Pin the card to its container's height (lg+) and scroll the sections
   * inside it, so the card frame and its footer stay put. Off by default:
   * standalone pages let the whole page scroll instead.
   */
  fillHeight?: boolean;
}) {
  const [selectedToolkits, setSelectedToolkits] = useState<Set<string>>(
    new Set(defaultValues?.toolkits ?? ["composio_search"]),
  );
  const [cron, setCron] = useState(defaultValues?.cron || "0 8 * * 1-5");
  const [triggerType, setTriggerType] = useState<"cron" | "event">(
    defaultValues?.triggerType ?? "cron",
  );
  const [eventTriggers, setEventTriggers] = useState<Set<string>>(
    new Set(defaultValues?.eventTriggers ?? []),
  );
  const [triggerTypes, setTriggerTypes] = useState<TriggerTypeOption[]>([]);
  const [extraSlug, setExtraSlug] = useState("");
  // Slugs typed in by hand (e.g. an app connected in another tab) plus any the
  // workflow already had but that isn't currently connected — never drop those
  // silently on save.
  const [extraToolkits, setExtraToolkits] = useState<ToolkitOption[]>(() => {
    const known = new Set([
      ...availableToolkits.map((t) => t.slug),
      WEB_SEARCH.slug,
    ]);
    return (defaultValues?.toolkits ?? [])
      .filter((slug) => !known.has(slug))
      .map((slug) => ({ slug, name: TOOLKIT_LABELS[slug] ?? slug }));
  });

  const options: ToolkitOption[] = [
    WEB_SEARCH,
    ...availableToolkits,
    ...extraToolkits,
  ];

  const toolkitKey = [...selectedToolkits].sort().join(",");

  /*
   * Which events you can listen to depends on which apps the workflow uses,
   * so the catalog is fetched per toolkit selection — and only in event mode,
   * since a scheduled workflow never needs it.
   */
  useEffect(() => {
    if (triggerType !== "event") return;
    const controller = new AbortController();
    fetch(`/api/trigger-types?toolkits=${encodeURIComponent(toolkitKey)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setTriggerTypes(data.items ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [triggerType, toolkitKey]);

  function toggleEventTrigger(slug: string) {
    setEventTriggers((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleToolkit(toolkit: string) {
    setSelectedToolkits((prev) => {
      const next = new Set(prev);
      if (next.has(toolkit)) next.delete(toolkit);
      else next.add(toolkit);
      return next;
    });
  }

  function addExtraToolkit() {
    const slug = extraSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_");
    if (!slug) return;
    if (!options.some((o) => o.slug === slug)) {
      setExtraToolkits((prev) => [
        ...prev,
        { slug, name: TOOLKIT_LABELS[slug] ?? slug },
      ]);
    }
    setSelectedToolkits((prev) => new Set(prev).add(slug));
    setExtraSlug("");
  }

  return (
    // `overflow-clip` rather than `hidden` in the page-scroll case: it still clips
    // the section corners but doesn't become a scroll container, which would kill
    // the sticky footer. In `fillHeight` mode the card itself is the fixed frame
    // and `sections` below is the scroll port.
    <form
      action={action}
      className={`rounded-container border-border bg-surface @container flex flex-col overflow-clip border ${
        fillHeight ? "lg:h-full lg:min-h-0" : ""
      }`}
    >
      <div
        className={`bg-border flex flex-col gap-px ${
          fillHeight ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : ""
        }`}
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

        <Section title="Trigger">
          <input type="hidden" name="triggerType" value={triggerType} />

          <div className="flex gap-1.5">
            {(
              [
                { value: "cron", label: "On a schedule" },
                { value: "event", label: "On an event" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setTriggerType(mode.value)}
                className={`h-8 cursor-pointer rounded-full border px-3.5 text-xs font-medium transition-colors ${
                  triggerType === mode.value
                    ? "border-foreground bg-surface-2 text-foreground"
                    : "border-border text-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {triggerType === "cron" ? (
            <>
              <div className="grid gap-4 @sm:grid-cols-2">
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
            </>
          ) : (
            <EventTriggerPicker
              options={triggerTypes}
              selected={eventTriggers}
              onToggle={toggleEventTrigger}
            />
          )}
        </Section>

        <Section title="Tools">
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
            {options.map((toolkit) => {
              const on = selectedToolkits.has(toolkit.slug);
              return (
                <label
                  key={toolkit.slug}
                  className={`rounded-control relative flex cursor-pointer items-center gap-2 border px-2 py-1.5 text-[13px] font-medium transition-colors ${
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
                    <span className="rounded-control border-border bg-surface-2 text-subtle flex h-7 w-7 shrink-0 items-center justify-center border">
                      <Globe className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <ToolkitLogo
                      slug={toolkit.slug}
                      name={toolkit.name}
                      logo={toolkit.logo}
                    />
                  )}
                  <span className="truncate">{toolkit.name}</span>
                  {on && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                </label>
              );
            })}
          </div>

          {availableToolkits.length === 0 && (
            <p className="text-subtle text-xs">
              Only web search available —{" "}
              <Link
                href="/connections"
                className="text-accent-text underline underline-offset-2"
              >
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
          <div className="grid gap-4 @sm:grid-cols-2">
            <Field label="Model">
              <ModelPicker
                defaultValue={defaultValues?.model}
                initialModels={models}
              />
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
            <TargetWithInput
              name="deliverSlackChannel"
              label="Slack channel"
              hint="Needs Slack connected."
              inputName="slackChannel"
              placeholder="#general or C0123456789"
              defaultChecked={defaultValues?.deliverSlackChannel}
              defaultValue={defaultValues?.slackChannel}
            />
            <TargetWithInput
              name="deliverEmail"
              label="Email"
              hint="Sent through your connected Gmail."
              inputName="emailTo"
              type="email"
              placeholder="you@example.com"
              defaultChecked={defaultValues?.deliverEmail}
              defaultValue={defaultValues?.emailTo}
            />
            <TargetWithInput
              name="deliverWebhook"
              label="Webhook"
              hint="POSTed as JSON by the runner itself — no tool involved."
              inputName="webhookUrl"
              type="url"
              placeholder="https://example.com/hook"
              defaultChecked={defaultValues?.deliverWebhook}
              defaultValue={defaultValues?.webhookUrl}
            />
          </div>
          <p className="text-subtle text-xs leading-relaxed">
            Nothing is sent on a run where the agent finds no updates — only the
            dashboard records it.
          </p>
        </Section>

        <Section title="Tool filters">
          <div className="grid gap-4 @sm:grid-cols-2">
            <Field
              label="Allow only"
              hint="Optional whitelist. Trailing * works: GITHUB_LIST_*"
            >
              <input
                name="allowTools"
                defaultValue={defaultValues?.allowTools?.join(", ")}
                placeholder="GITHUB_LIST_*, GMAIL_FETCH_EMAILS"
                className="input font-mono text-[12px]"
              />
            </Field>
            <Field label="Never use" hint="Wins over the allow list.">
              <input
                name="denyTools"
                defaultValue={defaultValues?.denyTools?.join(", ")}
                placeholder="SLACK_SEARCH_MESSAGES"
                className="input font-mono text-[12px]"
              />
            </Field>
          </div>
          <p className="text-subtle text-xs leading-relaxed">
            A toolkit can expose hundreds of tools, and every schema loaded is
            prompt tokens spent on every step. Narrow it when a workflow only
            ever needs two or three.
          </p>
        </Section>
      </div>

      {/* In fillHeight mode it sits outside the scroll port, so it's simply the
          card's last row. Otherwise it sticks to the viewport bottom while the
          form is taller than it, so the save action is never a scroll away. */}
      <div
        className={`border-border bg-bg-subtle/90 flex items-center justify-between gap-3 border-t px-5 py-3 backdrop-blur-md ${
          fillHeight ? "lg:shrink-0" : "sticky bottom-0"
        }`}
      >
        <p className="text-subtle text-xs">
          Read-only — the agent never writes.
        </p>
        <FormSubmitButton>{submitLabel}</FormSubmitButton>
      </div>
    </form>
  );
}

/**
 * Event triggers for the toolkits this workflow uses. Anything already saved
 * stays listed even when the catalog can't be reached, so an unreachable
 * Composio never silently drops a workflow's trigger on save.
 */
function EventTriggerPicker({
  options,
  selected,
  onToggle,
}: {
  options: TriggerTypeOption[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
}) {
  const known = new Set(options.map((o) => o.slug));
  const rows = [
    ...options,
    ...[...selected]
      .filter((slug) => !known.has(slug))
      .map((slug) => ({
        slug,
        name: slug,
        description: "Saved earlier — not in the current catalog.",
        toolkit: "",
      })),
  ];

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="text-subtle text-xs leading-relaxed">
          No events available for the selected tools. Pick a connected app above
          — web search has no events.
        </p>
      ) : (
        <div className="border-border rounded-control max-h-64 overflow-y-auto border">
          {rows.map((option) => {
            const on = selected.has(option.slug);
            return (
              <label
                key={option.slug}
                className={`border-border flex cursor-pointer items-start gap-2.5 border-b px-3 py-2.5 transition-colors last:border-b-0 ${
                  on ? "bg-surface-2" : "hover:bg-surface-hover"
                }`}
              >
                <input
                  type="checkbox"
                  name="eventTriggers"
                  value={option.slug}
                  checked={on}
                  onChange={() => onToggle(option.slug)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--solid)]"
                />
                <span className="min-w-0">
                  <span className="text-foreground block font-mono text-[12px] font-medium">
                    {option.slug}
                  </span>
                  <span className="text-subtle line-clamp-2 block text-xs">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      <p className="text-subtle text-xs leading-relaxed">
        The workflow runs each time one of these fires, with the event payload
        handed to the agent.
      </p>
    </div>
  );
}

/** A delivery target whose destination field only appears once it's on. */
function TargetWithInput({
  name,
  label,
  hint,
  inputName,
  placeholder,
  type = "text",
  defaultChecked,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
  inputName: string;
  placeholder?: string;
  type?: string;
  defaultChecked?: boolean;
  defaultValue?: string;
}) {
  const [on, setOn] = useState(Boolean(defaultChecked));

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`rounded-control border-border hover:border-border-strong flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 transition-colors`}
      >
        <input
          type="checkbox"
          name={name}
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--solid)]"
        />
        <span className="min-w-0">
          <span className="text-foreground block text-[13px] font-medium">
            {label}
          </span>
          {hint && <span className="text-subtle block text-xs">{hint}</span>}
        </span>
      </label>
      {on && (
        <input
          name={inputName}
          type={type}
          required
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="input ml-6 h-9"
          aria-label={`${label} destination`}
        />
      )}
    </div>
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
    <section className="bg-surface grid gap-x-8 gap-y-4 px-5 py-5 @xl:grid-cols-[180px_1fr] @xl:py-6">
      <div>
        <h2 className="heading-14 text-foreground">{title}</h2>
        {description && (
          <p className="text-subtle mt-1 hidden text-xs leading-relaxed @xl:block">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function FormSubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass("primary", "md")}
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-foreground text-[13px] font-medium">{label}</label>
      {children}
      {hint && <p className="text-subtle text-xs leading-relaxed">{hint}</p>}
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
      className={`rounded-control border-border flex items-start gap-2.5 border px-3 py-2.5 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-70"
          : "hover:border-border-strong cursor-pointer"
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
        <span className="text-foreground block text-[13px] font-medium">
          {label}
        </span>
        {hint && <span className="text-subtle block text-xs">{hint}</span>}
      </span>
    </label>
  );
}
