"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CronExpressionParser } from "cron-parser";
import { useFormStatus } from "react-dom";
import type { WorkflowFormState } from "@/lib/actions";
import Link from "next/link";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { buttonClass } from "@/components/ui";
import { ToolkitLogo } from "@/components/toolkit-logo";
import { ModelPicker } from "@/components/model-picker";
import { fetchJson } from "@/lib/fetch-json";
import type { ModelInfo } from "@/lib/model-tiers";
import {
  Check,
  Globe,
  SlidersHorizontal,
  FileText,
  CalendarClock,
  Wrench,
  Cpu,
  Send,
  Filter,
  TriangleAlert,
} from "lucide-react";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Weekdays 8am", value: "0 8 * * 1-5" },
  { label: "Daily 9am", value: "0 9 * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Fridays 5pm", value: "0 17 * * 5" },
];

/*
 * A fixed zone list rather than `Intl.supportedValuesOf("timeZone")`: that call
 * returns whatever ICU the runtime shipped with, so Node and the browser can
 * disagree and hydration mismatches. These cover every common offset; the saved
 * value is spliced in below if it isn't here.
 */
const TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Anchorage",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu",
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
  readOnly: boolean;
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
  title,
}: {
  /**
   * A `useActionState` action: it returns the failure instead of throwing, so
   * a rejected save re-renders this form — with everything the user typed
   * still in it — under an explanation, rather than swapping the page for the
   * error boundary.
   */
  action: (
    state: WorkflowFormState,
    formData: FormData,
  ) => Promise<WorkflowFormState>;
  defaultValues?: Partial<WorkflowFormValues>;
  submitLabel: string;
  /**
   * Optional card header. Set it when the form sits beside another card (the
   * builder) so both panes start on the same baseline; standalone pages already
   * have a page header and don't need a second one.
   */
  title?: string;
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
  const [state, formAction] = useActionState<WorkflowFormState, FormData>(
    action,
    { error: null },
  );

  /*
   * React resets an uncontrolled form once its action settles — including when
   * the action came back with an error — so after a rejected save the DOM
   * fields fall back to their `defaultValue`. Seeding those from what was just
   * submitted is what makes "fix the one bad field and press Save again"
   * possible instead of retyping the whole form.
   *
   * Only the uncontrolled fields need this. Toolkits, trigger mode, cron,
   * timezone and the delivery checkboxes are React state, and state survives
   * the reset untouched.
   */
  const sent = state.values;
  const initial = {
    name: sent ? (sent.name ?? "") : defaultValues?.name,
    goal: sent ? (sent.goal ?? "") : defaultValues?.goal,
    maxSteps: sent
      ? Number(sent.maxSteps) || 15
      : (defaultValues?.maxSteps ?? 15),
    slackChannel: sent
      ? (sent.slackChannel ?? "")
      : defaultValues?.slackChannel,
    emailTo: sent ? (sent.emailTo ?? "") : defaultValues?.emailTo,
    webhookUrl: sent ? (sent.webhookUrl ?? "") : defaultValues?.webhookUrl,
    allowTools: sent
      ? (sent.allowTools ?? "")
      : defaultValues?.allowTools?.join(", "),
    denyTools: sent
      ? (sent.denyTools ?? "")
      : defaultValues?.denyTools?.join(", "),
  };

  const [selectedToolkits, setSelectedToolkits] = useState<Set<string>>(
    new Set(defaultValues?.toolkits ?? ["composio_search"]),
  );
  // Controlled only so the header can show a live count — everything else
  // about the field (validation, submission) works the same as uncontrolled.
  const [goal, setGoal] = useState(initial.goal ?? "");
  // No tokenizer on the client; ~4 chars/token is the standard rough estimate
  // and is plenty for "am I anywhere near the limit" purposes.
  const goalTokens = goal.trim() ? Math.ceil(goal.trim().length / 4) : 0;
  const [cron, setCron] = useState(defaultValues?.cron || "0 8 * * 1-5");
  const [triggerType, setTriggerType] = useState<"cron" | "event">(
    defaultValues?.triggerType ?? "cron",
  );
  const [eventTriggers, setEventTriggers] = useState<Set<string>>(
    new Set(defaultValues?.eventTriggers ?? []),
  );
  const [triggerTypes, setTriggerTypes] = useState<TriggerTypeOption[]>([]);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [timezone, setTimezone] = useState(
    defaultValues?.timezone ?? "Asia/Kolkata",
  );
  // Mirrored in state so the footer can say what the run will actually be
  // allowed to do.
  const [allowWrites, setAllowWrites] = useState(
    defaultValues?.readOnly === false,
  );

  // Same parser the dispatcher schedules with, so what the field says about an
  // expression is what the ticker will actually do with it.
  const cronPreview = useMemo(() => {
    if (!cron.trim()) return { next: undefined, error: undefined };
    try {
      const next = CronExpressionParser.parse(cron, { tz: timezone })
        .next()
        .toDate();
      return {
        next: `Next: ${next.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone,
        })}`,
        error: undefined,
      };
    } catch {
      return { next: undefined, error: "Not a valid cron expression." };
    }
  }, [cron, timezone]);

  // A workflow saved with a zone outside the list still has to round-trip.
  const saved = defaultValues?.timezone;
  const timezoneOptions =
    saved && !TIMEZONES.includes(saved)
      ? [saved, ...TIMEZONES].sort()
      : TIMEZONES;

  // Only what Composio reports as ACTIVE right now, plus web search. A toolkit
  // the workflow was saved with but that is no longer connected can't be picked
  // — it rides along as a hidden input so saving doesn't silently drop it.
  const options: ToolkitOption[] = [WEB_SEARCH, ...availableToolkits];
  const offline = (defaultValues?.toolkits ?? []).filter(
    (slug) => !options.some((o) => o.slug === slug),
  );

  const toolkitKey = [...selectedToolkits].sort().join(",");

  /*
   * Which events you can listen to depends on which apps the workflow uses,
   * so the catalog is fetched per toolkit selection — and only in event mode,
   * since a scheduled workflow never needs it.
   */
  useEffect(() => {
    if (triggerType !== "event") return;
    const controller = new AbortController();

    fetchJson<{ items?: TriggerTypeOption[] }>(
      `/api/trigger-types?toolkits=${encodeURIComponent(toolkitKey)}`,
      { signal: controller.signal },
    )
      // Cleared here rather than at the top of the effect: a synchronous
      // setState in an effect body cascades a render for every toolkit toggle.
      .then((data) => {
        setTriggerTypes(Array.isArray(data.items) ? data.items : []);
        setTriggerError(null);
      })
      .catch((err) => {
        // Switching toolkits aborts the in-flight request; that isn't a
        // failure worth reporting.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Previously swallowed entirely, so an unreachable Composio looked
        // exactly like "these apps have no events" — with no way to tell that
        // picking an event was impossible rather than unnecessary.
        setTriggerTypes([]);
        setTriggerError(err instanceof Error ? err.message : String(err));
      });

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

  return (
    // `overflow-clip` rather than `hidden` in the page-scroll case: it still clips
    // the section corners but doesn't become a scroll container, which would kill
    // the sticky footer. In `fillHeight` mode the card itself is the fixed frame
    // and `sections` below is the scroll port.
    <form
      action={formAction}
      className={`rounded-container border-border bg-surface @container flex flex-col overflow-clip border ${
        fillHeight ? "lg:h-full lg:min-h-0" : ""
      }`}
    >
      {title && (
        <div className="border-border bg-surface flex h-12 shrink-0 items-center gap-2 border-b px-5">
          <span className="rounded-control border-border bg-bg-subtle text-foreground flex h-7 w-7 items-center justify-center border">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="heading-14 text-foreground">{title}</span>
        </div>
      )}

      <div
        // Hairlines come from `divide-y`, not a gray backdrop showing through
        // 1px gaps — that backdrop was also what the scroll port painted below
        // the last section, so a short form ended in a slab of border gray.
        className={`divide-border bg-surface flex flex-col divide-y ${
          fillHeight ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : ""
        }`}
      >
        <Section title="Basics" icon={FileText}>
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={initial.name}
              placeholder="morning-brief"
              className="input"
            />
          </Field>

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-foreground text-[13px] font-medium">
                Goal
              </label>
              <span className="text-subtle text-xs tabular-nums">
                ~{goalTokens.toLocaleString()} tokens
              </span>
            </div>
            <textarea
              name="goal"
              required
              rows={5}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Check my calendar for today and my assigned GitHub issues. Summarize into a short digest. Flag any meeting conflicts."
              className="input font-mono text-[13px]"
            />
          </div>
        </Section>

        <Section title="Trigger" icon={CalendarClock}>
          <input type="hidden" name="triggerType" value={triggerType} />

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "cron", label: "On a schedule" },
                { value: "event", label: "On an event" },
              ] as const
            ).map((mode) => (
              <Pill
                key={mode.value}
                selected={triggerType === mode.value}
                onClick={() => setTriggerType(mode.value)}
              >
                {mode.label}
              </Pill>
            ))}
          </div>

          {triggerType === "cron" ? (
            <>
              {/* Presets first: picking one is the common path, and the fields
                  below it are the correction — not the other way round. */}
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((preset) => (
                  <Pill
                    key={preset.value}
                    selected={cron === preset.value}
                    onClick={() => setCron(preset.value)}
                  >
                    {preset.label}
                  </Pill>
                ))}
              </div>

              <div className="grid gap-4 @lg:grid-cols-2">
                <Field
                  label="Cron"
                  hint={
                    cronPreview.error ? (
                      <span className="text-danger-text">
                        {cronPreview.error}
                      </span>
                    ) : (
                      // Next-run text is relative to "now", so server and
                      // client disagree by design.
                      <span suppressHydrationWarning>{cronPreview.next}</span>
                    )
                  }
                >
                  <input
                    name="cron"
                    required
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                    aria-invalid={Boolean(cronPreview.error)}
                    className={`input font-mono ${
                      cronPreview.error
                        ? "border-danger-line focus:border-danger"
                        : ""
                    }`}
                  />
                </Field>

                <Field label="Timezone">
                  <select
                    name="timezone"
                    required
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="input font-mono"
                  >
                    {timezoneOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          ) : (
            <EventTriggerPicker
              options={triggerTypes}
              selected={eventTriggers}
              onToggle={toggleEventTrigger}
              error={triggerError}
            />
          )}
        </Section>

        <Section title="Tools" icon={Wrench}>
          <div className="grid grid-cols-2 gap-2">
            {options.map((toolkit) => {
              const on = selectedToolkits.has(toolkit.slug);
              return (
                <label
                  key={toolkit.slug}
                  // The real checkbox is sr-only, so the label carries the
                  // focus ring — otherwise keyboard users see nothing move.
                  className={`rounded-control has-[:focus-visible]:outline-foreground relative flex h-11 cursor-pointer items-center gap-2 border px-2 text-[13px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
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
                      <Globe className="h-4 w-4" />
                    </span>
                  ) : (
                    <ToolkitLogo
                      slug={toolkit.slug}
                      name={toolkit.name}
                      logo={toolkit.logo}
                    />
                  )}
                  <span className="truncate">{toolkit.name}</span>
                  {on && <Check className="ml-auto h-4 w-4 shrink-0" />}
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

          {offline.length > 0 && (
            <p className="text-subtle text-xs leading-relaxed">
              Kept but not connected:{" "}
              <span className="font-mono">
                {offline.map((s) => TOOLKIT_LABELS[s] ?? s).join(", ")}
              </span>{" "}
              —{" "}
              <Link
                href="/connections"
                className="text-accent-text underline underline-offset-2"
              >
                reconnect
              </Link>{" "}
              to use them again.
              {offline.map((slug) => (
                <input key={slug} type="hidden" name="toolkits" value={slug} />
              ))}
            </p>
          )}
        </Section>

        <Section title="Model" icon={Cpu}>
          {/* Stacked, not side by side: model names are long enough that the
              picker wants the full width, and the step count needs none of it. */}
          <div className="flex flex-col gap-4">
            <Field label="Model">
              <ModelPicker
                defaultValue={defaultValues?.model}
                initialModels={models}
              />
            </Field>

            <Field label="Permissions">
              <Checkbox
                name="allowWrites"
                checked={allowWrites}
                onChange={setAllowWrites}
                label="Allow write tools"
                hint="Off (default): the agent reads, and only writes what a delivery target needs. On: any tool its toolkits expose."
              />
            </Field>

            <Field
              label="Max steps"
              hint="One step = one model call plus its tool calls. Hit the cap and the run is marked truncated, keeping whatever it had."
            >
              <input
                type="number"
                name="maxSteps"
                min={1}
                max={30}
                defaultValue={initial.maxSteps}
                className="input"
              />
            </Field>
          </div>
        </Section>

        <Section title="Delivery" icon={Send}>
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
              defaultValue={initial.slackChannel}
            />
            <TargetWithInput
              name="deliverEmail"
              label="Email"
              hint="Sent through your connected Gmail."
              inputName="emailTo"
              type="email"
              placeholder="you@example.com"
              defaultChecked={defaultValues?.deliverEmail}
              defaultValue={initial.emailTo}
            />
            <TargetWithInput
              name="deliverWebhook"
              label="Webhook"
              hint="POSTed as JSON by the runner itself — no tool involved."
              inputName="webhookUrl"
              type="url"
              placeholder="https://example.com/hook"
              defaultChecked={defaultValues?.deliverWebhook}
              defaultValue={initial.webhookUrl}
            />
          </div>
          <p className="text-subtle text-xs leading-relaxed">
            Nothing is sent on a run where the agent finds no updates — only the
            dashboard records it.
          </p>
        </Section>

        <Section title="Tool filters" icon={Filter}>
          {/* Comma-separated tool globs need width; two columns only earn their
              keep once the card is genuinely wide. */}
          <div className="grid gap-4 @2xl:grid-cols-2">
            <Field
              label="Allow only"
              hint="Optional whitelist. Trailing * works: GITHUB_LIST_*"
            >
              <input
                name="allowTools"
                defaultValue={initial.allowTools}
                placeholder="GITHUB_LIST_*, GMAIL_FETCH_EMAILS"
                className="input font-mono text-[12px]"
              />
            </Field>
            <Field label="Never use" hint="Wins over the allow list.">
              <input
                name="denyTools"
                defaultValue={initial.denyTools}
                placeholder="SLACK_SEARCH_MESSAGES"
                className="input font-mono text-[12px]"
              />
            </Field>
          </div>
        </Section>
      </div>

      {/* Between the scroll port and the save bar: the one place that is on
          screen in both layouts at the moment the user has just pressed Save
          and is looking for what happened. */}
      {state.error && (
        <p
          role="alert"
          className="border-danger-soft bg-danger-soft text-danger-text flex shrink-0 items-start gap-2 border-t px-5 py-3 text-[13px]"
        >
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
          <span className="min-w-0">{state.error}</span>
        </p>
      )}

      {/* In fillHeight mode it sits outside the scroll port, so it's simply the
          card's last row. Otherwise it sticks to the viewport bottom while the
          form is taller than it, so the save action is never a scroll away. */}
      <div
        className={`border-border bg-bg-subtle/90 flex items-center justify-between gap-3 border-t px-5 py-3 backdrop-blur-md ${
          // Below lg the card is part of the page scroll even in fillHeight
          // mode, so the save bar sticks there too and only becomes the card's
          // last row once the pane owns its own height.
          fillHeight
            ? "sticky bottom-0 lg:static lg:shrink-0"
            : "sticky bottom-0"
        }`}
      >
        {/* Hidden on a phone rather than truncated: at 390px this clipped to
            "Read-only — the agent nev…", which is worse than absent. */}
        <p className="text-subtle hidden min-w-0 truncate text-xs sm:block">
          {allowWrites
            ? "Write tools allowed — the agent can change things in connected apps."
            : "Read-only — the agent never writes."}
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
  error,
}: {
  options: TriggerTypeOption[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  /** Why the catalog is empty, when it's empty because the fetch failed. */
  error?: string | null;
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
      {error && (
        <p className="rounded-control border-warn-soft bg-warn-soft text-warn-text flex items-start gap-2 border px-3 py-2 text-xs">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            Couldn&apos;t load the event catalog from Composio — {error}. Any
            events already saved on this workflow are still listed below.
          </span>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-subtle text-xs leading-relaxed">
          {error
            ? "No events to show while the catalog is unavailable."
            : "No events available for the selected tools. Pick a connected app above — web search has no events."}
        </p>
      ) : (
        <div className="border-border rounded-control max-h-64 overflow-y-auto border">
          {rows.map((option) => {
            const on = selected.has(option.slug);
            return (
              <label
                key={option.slug}
                className={`border-border has-[:focus-visible]:outline-foreground flex cursor-pointer items-start gap-2.5 border-b px-3 py-2.5 transition-colors last:border-b-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 ${
                  on ? "bg-surface-2" : "hover:bg-surface-hover"
                }`}
              >
                <input
                  type="checkbox"
                  name="eventTriggers"
                  value={option.slug}
                  checked={on}
                  onChange={() => onToggle(option.slug)}
                  className="sr-only"
                />
                <CheckBox on={on} />
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
        className={`rounded-control has-[:focus-visible]:outline-foreground flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
          on
            ? "border-border-strong bg-surface-2"
            : "border-border hover:border-border-strong"
        }`}
      >
        <input
          type="checkbox"
          name={name}
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="sr-only"
        />
        <CheckBox on={on} />
        <span className="min-w-0">
          <span className="text-foreground block text-[13px] font-medium">
            {label}
          </span>
          {hint && <span className="text-subtle block text-xs">{hint}</span>}
        </span>
      </label>
      {on && (
        // Indented to the label text above it (12px padding + 14px box + 10px
        // gap). The pad lives on a wrapper because `.input` is width:100% and
        // an `ml-*` on the field itself pushed it past the card edge.
        <div className="pl-9">
          <input
            name={inputName}
            type={type}
            required
            defaultValue={defaultValue}
            placeholder={placeholder}
            className="input h-9"
            aria-label={`${label} destination`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The box a checkbox actually shows. The native control paints a solid black
 * square through `accent-color`, which reads as a filled blob at 14px next to
 * everything else here — this is the same lucide `Check` the toolkit tiles use,
 * on a bordered chip. The real <input> stays in the DOM, sr-only, so form
 * submission and screen readers are unchanged.
 */
function CheckBox({
  on,
  disabled = false,
}: {
  on: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        on
          ? "border-foreground bg-solid text-solid-fg"
          : "border-border bg-bg text-transparent"
      } ${disabled ? "opacity-60" : ""}`}
    >
      {/* Utility beats the base-layer 1.5 stroke — a check this small needs weight. */}
      <Check className="h-3 w-3 [stroke-width:2.75px]" />
    </span>
  );
}

/** One pill shape for every toggle chip in the form — same height, same ring. */
function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-control h-8 cursor-pointer border px-3.5 text-xs font-medium transition-colors ${
        selected
          ? "border-foreground bg-surface-2 text-foreground"
          : "border-border text-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface grid gap-x-8 gap-y-3 px-5 py-5 @xl:grid-cols-[168px_minmax(0,1fr)] @xl:gap-y-4 @xl:py-6">
      <div className="@xl:self-start">
        <h2 className="heading-14 text-foreground flex items-center gap-2">
          {Icon && <Icon className="text-subtle h-4 w-4 shrink-0" />}
          {title}
        </h2>
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
  hint?: React.ReactNode;
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
  onChange,
}: {
  label: string;
  hint?: string;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  /** Pass with `checked` to drive the row from parent state. */
  onChange?: (checked: boolean) => void;
}) {
  // Uncontrolled rows still need the box to react to a click, so the visual
  // state is mirrored locally and the input stays the source of truth.
  const [on, setOn] = useState(Boolean(checked ?? defaultChecked));

  return (
    <label
      className={`rounded-control border-border has-[:focus-visible]:outline-foreground flex items-start gap-2.5 border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
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
        readOnly={checked !== undefined && !onChange}
        onChange={(e) => {
          setOn(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="sr-only"
      />
      <CheckBox on={checked ?? on} disabled={disabled} />
      <span className="min-w-0">
        <span className="text-foreground block text-[13px] font-medium">
          {label}
        </span>
        {hint && <span className="text-subtle block text-xs">{hint}</span>}
      </span>
    </label>
  );
}
