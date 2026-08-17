"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CronExpressionParser } from "cron-parser";
import { createPortal, useFormStatus } from "react-dom";
import type { WorkflowFormState } from "@/lib/actions";
import Link from "next/link";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/timezones";
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
  ChevronsUpDown,
  Gauge,
  Info,
} from "lucide-react";
import { CronBuilder, describeCron } from "@/components/cron-builder";
import { SignalsEditor } from "@/components/signals-editor";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { SignalDecl } from "@/lib/outcome/condition";

/** Web search needs no auth, so it's always offered — and always usable. */
const WEB_SEARCH: ToolkitOption = {
  slug: "composio_search",
  name: "Web search",
  status: "active",
  usable: true,
};

export type ToolkitOption = {
  slug: string;
  name: string;
  logo?: string;
  /**
   * Connection state. A toolkit that isn't `usable` stays offered and
   * selectable — flagged, not hidden. Hiding it meant editing an unrelated
   * field silently dropped a toolkit whose token had expired.
   */
  status?: string;
  usable?: boolean;
};

export type TriggerTypeOption = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
};

/** A workflow this one may be chained behind, for the parent picker. */
export type ParentOption = {
  id: string;
  name: string;
  /** The parent's signals — what a trigger condition may be written against. */
  signals: SignalDecl[];
};

export type WorkflowFormValues = {
  name: string;
  goal: string;
  triggerType: "cron" | "event" | "workflow";
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
  parentWorkflowId: string;
  parentCondition: string;
  alertCondition: string;
  signalSchema: SignalDecl[];
  monthlyCostCapUsd: string;
};

export function WorkflowForm({
  action,
  defaultValues,
  submitLabel,
  availableToolkits = [],
  models = [],
  parentOptions = [],
  fillHeight = false,
  title,
}: {
  /**
   * A `useActionState` action: returns the failure instead of throwing, so a
   * rejected save re-renders this form (with everything typed still in it)
   * under an explanation, rather than swapping in the error boundary.
   */
  action: (
    state: WorkflowFormState,
    formData: FormData,
  ) => Promise<WorkflowFormState>;
  defaultValues?: Partial<WorkflowFormValues>;
  submitLabel: string;
  /**
   * Optional card header, for when the form sits beside another card (the
   * builder) so both panes share a baseline; standalone pages already have a
   * page header.
   */
  title?: string;
  /** Connected toolkits, straight from Composio — not a hardcoded list. */
  availableToolkits?: ToolkitOption[];
  /** Model catalog from AI Gateway; the picker refreshes it on open. */
  models?: ModelInfo[];
  /**
   * The owner's other workflows, for the chained trigger. Passed in rather
   * than fetched here: this is a client component, and the list must be
   * scoped to the owner server-side anyway.
   */
  parentOptions?: ParentOption[];
  /**
   * Pin the card to its container's height (lg+) and scroll sections inside
   * it, so the frame and footer stay put. Off by default: standalone pages
   * let the whole page scroll instead.
   */
  fillHeight?: boolean;
}) {
  const [state, formAction] = useActionState<WorkflowFormState, FormData>(
    action,
    { error: null },
  );

  /*
   * React resets an uncontrolled form once its action settles, even on error,
   * so DOM fields fall back to their `defaultValue`. Seeding those from what
   * was just submitted makes "fix the one bad field and Save again" possible
   * instead of retyping everything.
   *
   * Only uncontrolled fields need this — toolkits, trigger mode, cron,
   * timezone, and delivery checkboxes are React state and survive the reset.
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
    monthlyCostCapUsd: sent
      ? (sent.monthlyCostCapUsd ?? "")
      : (defaultValues?.monthlyCostCapUsd ?? ""),
  };

  const [selectedToolkits, setSelectedToolkits] = useState<Set<string>>(
    new Set(defaultValues?.toolkits ?? ["composio_search"]),
  );
  // Controlled only so the header can show a live count — validation and
  // submission still work as if uncontrolled.
  const [goal, setGoal] = useState(initial.goal ?? "");
  // No tokenizer on the client; ~4 chars/token is the standard rough estimate,
  // plenty for "am I near the limit".
  const goalTokens = goal.trim() ? Math.ceil(goal.trim().length / 4) : 0;
  const [cron, setCron] = useState(defaultValues?.cron || "0 8 * * 1-5");
  const [triggerType, setTriggerType] = useState<"cron" | "event" | "workflow">(
    defaultValues?.triggerType ?? "cron",
  );
  const [parentWorkflowId, setParentWorkflowId] = useState(
    defaultValues?.parentWorkflowId ?? "",
  );
  const [parentCondition, setParentCondition] = useState(
    defaultValues?.parentCondition ?? "",
  );
  const [eventTriggers, setEventTriggers] = useState<Set<string>>(
    new Set(defaultValues?.eventTriggers ?? []),
  );
  const [triggerTypes, setTriggerTypes] = useState<TriggerTypeOption[]>([]);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [timezone, setTimezone] = useState(
    defaultValues?.timezone ?? DEFAULT_TIMEZONE,
  );
  // Mirrored in state so the footer can say what the run is actually allowed
  // to do.
  const [allowWrites, setAllowWrites] = useState(
    defaultValues?.readOnly === false,
  );

  // Same parser the dispatcher schedules with, so the field's read of an
  // expression matches what the ticker does with it.
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

  // Every toolkit with a connection row, plus web search. Broken ones are
  // included and flagged, not hidden. A toolkit with no row at all still
  // rides along as a hidden input so an unrelated edit doesn't drop it.
  const options: ToolkitOption[] = [WEB_SEARCH, ...availableToolkits];
  const offline = (defaultValues?.toolkits ?? []).filter(
    (slug) => !options.some((o) => o.slug === slug),
  );

  const toolkitKey = [...selectedToolkits].sort().join(",");

  /*
   * Which events you can listen to depends on the workflow's apps, so the
   * catalog is fetched per toolkit selection, and only in event mode.
   */
  useEffect(() => {
    if (triggerType !== "event") return;
    const controller = new AbortController();

    fetchJson<{ items?: TriggerTypeOption[] }>(
      `/api/trigger-types?toolkits=${encodeURIComponent(toolkitKey)}`,
      { signal: controller.signal },
    )
      // Cleared here, not at the top of the effect: a synchronous setState in
      // an effect body cascades a render per toolkit toggle.
      .then((data) => {
        setTriggerTypes(Array.isArray(data.items) ? data.items : []);
        setTriggerError(null);
      })
      .catch((err) => {
        // Switching toolkits aborts the in-flight request — not a failure
        // worth reporting.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Previously swallowed entirely, so an unreachable Composio looked
        // identical to "these apps have no events".
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
    // `overflow-clip`, not `hidden`, in the page-scroll case: it still clips
    // section corners without becoming a scroll container, which would kill
    // the sticky footer. In `fillHeight` mode the card is the fixed frame and
    // `sections` below is the scroll port.
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
        // 1px gaps — that backdrop also painted below the last section,
        // leaving a short form ending in a slab of border gray.
        className={`divide-border bg-surface flex flex-col divide-y ${
          fillHeight ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : ""
        }`}
      >
        <Section
          title="Basics"
          icon={FileText}
          info={[
            "Name identifies the workflow across its runs and digests.",
            "Goal is the prompt run every time — say what to fetch, what to skip, what the output looks like.",
            "Markdown supported; longer goals cost more per run.",
          ]}
        >
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
            <label className="text-foreground text-[13px] font-medium">
              Goal
            </label>
            {/* The goal is a prompt written in markdown; the preview tab is
                where you check it before a run renders it. */}
            <MarkdownEditor
              name="goal"
              value={goal}
              onChange={setGoal}
              placeholder="Check today's calendar and my GitHub issues. Short digest, flag conflicts."
              meta={`~${goalTokens.toLocaleString()} tokens`}
            />
          </div>
        </Section>

        <Section
          title="Trigger"
          icon={CalendarClock}
          info={[
            "What starts a run — one mode: a cron schedule, a connected app's event, or a parent workflow finishing.",
            "Timezone drives the schedule and the monthly budget reset, so it is saved in every mode.",
          ]}
        >
          <input type="hidden" name="triggerType" value={triggerType} />
          {/*
           * Timezone picker lives in the cron branch since a schedule is the
           * obvious thing a zone applies to — but it's not the only thing:
           * the monthly budget resets on the workflow's own midnight. Without
           * this hidden field, saving an event or chained workflow silently
           * reset the zone to the default.
           */}
          {triggerType !== "cron" && (
            <input type="hidden" name="timezone" value={timezone} />
          )}

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "cron", label: "On a schedule" },
                { value: "event", label: "On an event" },
                { value: "workflow", label: "After another workflow" },
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
              {/* Builder first — composing is the common path, the cron field
                  below is the correction. Both edit the same string, so
                  neither can go stale. */}
              <CronBuilder value={cron} onChange={setCron} />

              <div className="grid gap-4 @lg:grid-cols-2">
                <Field
                  label="Cron"
                  hint={
                    cronPreview.error ? (
                      <span className="text-danger-text">
                        {cronPreview.error}
                      </span>
                    ) : (
                      // What the expression *means*, not just when it next
                      // fires — "Next: Wed 8:00" reads the same for a weekday
                      // schedule and a Wednesdays-only one. Falls back to the
                      // next-run text for exotic expressions; that's relative
                      // to "now", so server/client disagree by design.
                      <span suppressHydrationWarning>
                        {describeCron(cron) ?? cronPreview.next}
                      </span>
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
          ) : triggerType === "event" ? (
            <EventTriggerPicker
              options={triggerTypes}
              selected={eventTriggers}
              onToggle={toggleEventTrigger}
              error={triggerError}
            />
          ) : (
            <ParentTriggerPicker
              options={parentOptions}
              parentWorkflowId={parentWorkflowId}
              onParentChange={setParentWorkflowId}
              condition={parentCondition}
              onConditionChange={setParentCondition}
            />
          )}
        </Section>

        <Section
          title="Signals & alerts"
          icon={Gauge}
          info={[
            "Signals are named values each run extracts — a count, a percent, an age in days. Charted across runs.",
            "Only alert when: a condition over them, comparisons plus && || ! only.",
            "Empty condition delivers every digest; false records signals but sends nothing.",
          ]}
        >
          <SignalsEditor
            defaultSignals={defaultValues?.signalSchema ?? []}
            defaultCondition={defaultValues?.alertCondition ?? ""}
          />
        </Section>

        <Section
          title="Tools"
          icon={Wrench}
          info={[
            "Which connected apps the agent may call. Web search needs no connection.",
            "Fewer toolkits, fewer tools loaded — cheaper and less chance of a wrong call.",
            "Amber means reconnect on Connections first; disconnected picks stay selected, not dropped.",
          ]}
        >
          <div className="grid grid-cols-2 gap-2">
            {options.map((toolkit) => {
              const on = selectedToolkits.has(toolkit.slug);
              const broken = toolkit.usable === false;
              return (
                <label
                  key={toolkit.slug}
                  title={
                    broken
                      ? `${toolkit.name} needs reconnecting before this workflow can use it.`
                      : undefined
                  }
                  // Real checkbox is sr-only, so the label carries the focus
                  // ring — otherwise keyboard users see nothing move.
                  className={`rounded-control has-[:focus-visible]:outline-foreground relative flex h-11 cursor-pointer items-center gap-2 border px-2 text-[13px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                    broken
                      ? "border-warn-soft bg-warn-soft text-warn-text"
                      : on
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
                  {broken ? (
                    <TriangleAlert className="ml-auto h-4 w-4 shrink-0" />
                  ) : (
                    on && <Check className="ml-auto h-4 w-4 shrink-0" />
                  )}
                </label>
              );
            })}
          </div>

          {options.some((t) => t.usable === false) && (
            <p className="text-warn-text text-xs">
              Some apps need reconnecting before a run can use them —{" "}
              <Link
                href="/connections"
                className="underline underline-offset-2"
              >
                fix connections
              </Link>
              .
            </p>
          )}

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
            <p className="text-subtle text-xs">
              Kept, not connected:{" "}
              <span className="font-mono">
                {offline.map((s) => TOOLKIT_LABELS[s] ?? s).join(", ")}
              </span>{" "}
              —{" "}
              <Link
                href="/connections"
                className="text-accent-text underline underline-offset-2"
              >
                reconnect
              </Link>
              .
              {offline.map((slug) => (
                <input key={slug} type="hidden" name="toolkits" value={slug} />
              ))}
            </p>
          )}
        </Section>

        <Section
          title="Model"
          icon={Cpu}
          info={[
            "Stronger models cost more per step. Writes off means read-only; on allows post, send, update — never delete.",
            "Budget pauses the workflow at that month's spend; the crossing run still finishes.",
            "Max steps caps model-call rounds — at the cap the run saves what it had, marked truncated.",
          ]}
        >
          {/* Stacked, not side by side: model names want the full width, and
              step count needs none of it. */}
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
                // Names the workflow, not "it" — same flag as the builder's
                // "Workflow · write tools allowed" chip, to avoid confusion
                // over which agent a permission belongs to.
                label="Allow this workflow write tools"
                hint="Off, it only reads. On, it can post, send and update — never delete."
              />
            </Field>

            <Field
              label="Monthly budget (USD)"
              hint="Blank for no limit. Pauses the workflow once this month's spend reaches it; the run that crosses still finishes."
            >
              <input
                name="monthlyCostCapUsd"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                defaultValue={initial.monthlyCostCapUsd}
                placeholder="No limit"
                className="input font-mono tabular-nums"
              />
            </Field>

            <Field
              label="Max steps"
              hint="One step = a model call plus its tools. At the cap the run stops and saves what it had, marked truncated."
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

        <Section
          title="Delivery"
          icon={Send}
          info={[
            "Where the digest goes; dashboard always keeps it, extra targets are optional.",
            "Slack needs Slack connected, email goes through your Gmail, webhook is POSTed as JSON.",
            "An alert condition still gates these — only passing runs deliver.",
          ]}
        >
          <DeliveryPicker
            defaults={{
              deliverSlack: defaultValues?.deliverSlack,
              deliverSlackChannel: defaultValues?.deliverSlackChannel,
              deliverEmail: defaultValues?.deliverEmail,
              deliverWebhook: defaultValues?.deliverWebhook,
              slackChannel: initial.slackChannel,
              emailTo: initial.emailTo,
              webhookUrl: initial.webhookUrl,
            }}
          />
        </Section>

        <Section
          title="Tool filters"
          icon={Filter}
          info={[
            "Optional narrowing inside the picked toolkits — blank means no filtering.",
            "Allow only loads nothing else; Never use wins on any conflict.",
            "Comma-separated, trailing * matches a prefix; deletes need their exact name.",
          ]}
        >
          {/* Comma-separated tool globs need width; two columns only earn
              their keep once the card is genuinely wide. */}
          <div className="grid gap-4 @2xl:grid-cols-2">
            <Field
              label="Allow only"
              hint="Only these tools load. Trailing * matches a prefix; deletes need their exact name."
            >
              <input
                name="allowTools"
                defaultValue={initial.allowTools}
                placeholder="GITHUB_LIST_*, GMAIL_FETCH_EMAILS"
                className="input font-mono text-[12px]"
              />
            </Field>
            <Field label="Never use" hint="Wins over Allow only.">
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

      {/* Between the scroll port and save bar: on screen in both layouts
          right when the user just pressed Save and is looking for feedback. */}
      {state.error && (
        <p
          role="alert"
          className="border-danger-soft bg-danger-soft text-danger-text flex shrink-0 items-start gap-2 border-t px-5 py-3 text-[13px]"
        >
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
          <span className="min-w-0">{state.error}</span>
        </p>
      )}

      {/* In fillHeight mode it sits outside the scroll port as the card's
          last row. Otherwise it sticks to the viewport bottom so Save is
          never a scroll away. */}
      <div
        className={`border-border bg-bg-subtle/90 flex items-center justify-between gap-3 border-t px-5 py-3 backdrop-blur-md ${
          // Below lg the card is part of page scroll even in fillHeight mode,
          // so it sticks there too, becoming the card's last row only once
          // the pane owns its own height.
          fillHeight
            ? "sticky bottom-0 lg:static lg:shrink-0"
            : "sticky bottom-0"
        }`}
      >
        {/* Hidden on phone rather than truncated: at 390px this clipped to
            "Read-only — the agent nev…", worse than absent. */}
        <p className="text-subtle hidden min-w-0 truncate text-xs sm:block">
          {allowWrites
            ? "Write tools allowed — this workflow can change your apps."
            : "This workflow is read-only."}
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
/**
 * The chained trigger: which workflow runs first, and the condition over
 * that workflow's signals deciding whether this one fires.
 *
 * The condition reads the PARENT's signals, not this workflow's, so the
 * available names change with the selection and the helper text follows.
 */
function ParentTriggerPicker({
  options,
  parentWorkflowId,
  onParentChange,
  condition,
  onConditionChange,
}: {
  options: ParentOption[];
  parentWorkflowId: string;
  onParentChange: (id: string) => void;
  condition: string;
  onConditionChange: (value: string) => void;
}) {
  const parent = options.find((o) => o.id === parentWorkflowId);
  const names = (parent?.signals ?? []).map((s) => s.key).filter(Boolean);

  if (options.length === 0) {
    return (
      <p className="text-subtle text-xs leading-relaxed">
        No other workflows yet. Create one to chain this behind it.
      </p>
    );
  }

  return (
    <>
      <Field
        label="Runs after"
        hint="Starts when that one finishes, handed its digest and signals."
      >
        <select
          name="parentWorkflowId"
          required
          value={parentWorkflowId}
          onChange={(e) => onParentChange(e.target.value)}
          className="input"
        >
          <option value="">Pick a workflow…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Only run when"
        hint={
          !parent ? (
            "Pick a workflow above first."
          ) : names.length === 0 ? (
            "That workflow reports no signals — nothing to test. Runs every time it finishes."
          ) : (
            <>
              Empty runs every time. Against{" "}
              <span className="font-mono">{parent.name}</span>&apos;s signals:{" "}
              <span className="font-mono">{names.join(", ")}</span>
            </>
          )
        }
      >
        <input
          name="parentCondition"
          value={condition}
          onChange={(e) => onConditionChange(e.target.value)}
          disabled={!parent || names.length === 0}
          placeholder={names.length ? `${names[0]} > 0` : "No signals to test"}
          className="input font-mono text-[13px] disabled:cursor-not-allowed disabled:opacity-55"
        />
      </Field>
    </>
  );
}

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
                className={`border-border has-[:focus-visible]:outline-foreground relative flex cursor-pointer items-start gap-2.5 border-b px-3 py-2.5 transition-colors last:border-b-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 ${
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

/**
 * Delivery targets as one multi-select instead of four checkboxes. Delivery
 * is a short list set once and rarely revisited, and as cards it took more
 * vertical space than the goal did. Collapsed, it reads as a sentence —
 * "Dashboard, Slack DM, Email".
 *
 * Only *choosing* moved into the dropdown: a chosen target needing a
 * destination still gets a real field underneath, since a channel or address
 * typed inside a popover can't be checked while you work.
 */
type TargetKey = "slack" | "slackChannel" | "email" | "webhook";

const DELIVERY_TARGETS: Array<{
  key: TargetKey;
  /** The `deliver*` checkbox name the action reads. */
  name: string;
  label: string;
  hint: string;
  /** Targets with a destination field carry its name and shape. */
  input?: { name: string; type: string; placeholder: string };
}> = [
  {
    key: "slack",
    name: "deliverSlack",
    label: "Slack DM",
    hint: "Needs Slack connected.",
  },
  {
    key: "slackChannel",
    name: "deliverSlackChannel",
    label: "Slack channel",
    hint: "Needs Slack connected.",
    input: {
      name: "slackChannel",
      type: "text",
      placeholder: "#general or C0123456789",
    },
  },
  {
    key: "email",
    name: "deliverEmail",
    label: "Email",
    hint: "Sent through your connected Gmail.",
    input: { name: "emailTo", type: "email", placeholder: "you@example.com" },
  },
  {
    key: "webhook",
    name: "deliverWebhook",
    label: "Webhook",
    hint: "POSTed as JSON by the runner.",
    input: {
      name: "webhookUrl",
      type: "url",
      placeholder: "https://example.com/hook",
    },
  },
];

function DeliveryPicker({
  defaults,
}: {
  defaults: {
    deliverSlack?: boolean;
    deliverSlackChannel?: boolean;
    deliverEmail?: boolean;
    deliverWebhook?: boolean;
    slackChannel?: string;
    emailTo?: string;
    webhookUrl?: string;
  };
}) {
  const [selected, setSelected] = useState<Set<TargetKey>>(
    () =>
      new Set(
        [
          defaults.deliverSlack && "slack",
          defaults.deliverSlackChannel && "slackChannel",
          defaults.deliverEmail && "email",
          defaults.deliverWebhook && "webhook",
        ].filter(Boolean) as TargetKey[],
      ),
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Click-away, not a full-screen backdrop: this panel sits inside the
    // form's own scroll port, and a fixed overlay would swallow the scroll.
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggle(key: TargetKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const chosen = DELIVERY_TARGETS.filter((t) => selected.has(t.key));
  const summary = ["Dashboard", ...chosen.map((t) => t.label)].join(", ");
  const defaultValueFor = (inputName: string) =>
    ({
      slackChannel: defaults.slackChannel,
      emailTo: defaults.emailTo,
      webhookUrl: defaults.webhookUrl,
    })[inputName] ?? "";

  return (
    <div className="flex flex-col gap-2">
      {/* The dropdown is a control, not a form field: the action reads these
          hidden inputs, so opening/closing/unmounting the panel doesn't
          affect what's submitted. */}
      {chosen.map((t) => (
        <input key={t.name} type="hidden" name={t.name} value="on" />
      ))}

      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`rounded-control flex w-full cursor-pointer items-center gap-2 border px-3 py-2.5 text-left transition-colors ${
            open
              ? "border-border-strong bg-surface-2"
              : "border-border hover:border-border-strong"
          }`}
        >
          <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
            {summary}
          </span>
          <span className="text-subtle shrink-0 text-xs">
            {chosen.length + 1}
          </span>
          <ChevronsUpDown className="text-subtle h-4 w-4 shrink-0" />
        </button>

        {open && (
          // Absolute, not portalled: full-width inside a card it scrolls
          // with, so it stays anchored with no measuring.
          <div
            role="listbox"
            aria-multiselectable
            aria-label="Delivery targets"
            className="rounded-container border-border bg-surface shadow-pop absolute top-[calc(100%+4px)] right-0 left-0 z-30 overflow-hidden border"
          >
            <Row
              label="Dashboard"
              hint="Always on."
              on
              disabled
              onToggle={() => {}}
            />
            {DELIVERY_TARGETS.map((t) => (
              <Row
                key={t.key}
                label={t.label}
                hint={t.hint}
                on={selected.has(t.key)}
                onToggle={() => toggle(t.key)}
              />
            ))}
          </div>
        )}
      </div>

      {chosen
        .filter((t) => t.input)
        .map((t) => (
          <Field key={t.key} label={t.label}>
            <input
              name={t.input!.name}
              type={t.input!.type}
              required
              defaultValue={defaultValueFor(t.input!.name)}
              placeholder={t.input!.placeholder}
              className="input h-9"
              aria-label={`${t.label} destination`}
            />
          </Field>
        ))}
    </div>
  );
}

/** One selectable line in the delivery dropdown. */
function Row({
  label,
  hint,
  on,
  disabled = false,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      disabled={disabled}
      onClick={onToggle}
      className={`border-border flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 ${
        disabled ? "cursor-default" : "hover:bg-surface-hover cursor-pointer"
      } ${on ? "bg-surface-2" : ""}`}
    >
      <CheckBox on={on} disabled={disabled} />
      <span className="min-w-0">
        <span className="text-foreground block text-[13px] font-medium">
          {label}
        </span>
        <span className="text-subtle block text-xs">{hint}</span>
      </span>
    </button>
  );
}

/**
 * The box a checkbox actually shows. The native control paints a solid black
 * square via `accent-color`, which reads as a filled blob at 14px — this uses
 * the same lucide `Check` as the toolkit tiles, on a bordered chip. The real
 * <input> stays sr-only, so submission and screen readers are unchanged.
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
      {/* Utility beats the base-layer 1.5 stroke — needs weight this small. */}
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
  info,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Bullets shown by the heading's info button; omit for no button. */
  info?: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface grid gap-x-8 gap-y-3 px-5 py-5 @xl:grid-cols-[168px_minmax(0,1fr)] @xl:gap-y-4 @xl:py-6">
      <div className="@xl:self-start">
        <h2 className="heading-14 text-foreground flex items-center gap-2">
          {Icon && <Icon className="text-subtle h-4 w-4 shrink-0" />}
          {title}
          {info && <SectionInfo title={title} points={info} />}
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

const TIP_WIDTH = 300;

/**
 * Info marker beside a section heading; hover or keyboard focus shows a short
 * bulleted explainer. Portalled and fixed-positioned off the marker's rect,
 * not an in-flow popover: the form card is `overflow-clip` and its section
 * list scrolls, so a panel in the tree would be cut off at the card edge.
 */
function SectionInfo({ title, points }: { title: string; points: string[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  function show() {
    setRect(anchorRef.current?.getBoundingClientRect() ?? null);
  }
  const hide = () => setRect(null);

  useEffect(() => {
    if (!rect) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    // Rect is a viewport measurement, so it goes stale the moment anything
    // moves under it — cheaper to drop the tip than to re-measure on a scroll.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [rect]);

  // Left-aligned to the marker, flipped back inside on the right edge; below
  // it unless the viewport bottom is closer than the tip is tall.
  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - TIP_WIDTH - 8))
    : 0;
  const below = rect ? rect.bottom + 8 : 0;
  const flip = rect ? window.innerHeight - rect.bottom < 220 : false;

  return (
    <>
      {/*
       * A real button, not a span with role="button": it is inside a form, so
       * it needs the explicit type either way, and the native element brings
       * the focus and activation behaviour the role only claims. Click toggles
       * because hover is not available on touch.
       */}
      <button
        ref={anchorRef}
        type="button"
        aria-label={`About ${title}`}
        aria-expanded={rect !== null}
        aria-describedby={rect ? tipId : undefined}
        onClick={() => (rect ? hide() : show())}
        onMouseEnter={show}
        onMouseLeave={hide}
        // Only keyboard focus opens the tip. A tap focuses the button before
        // it clicks it, so an unconditional onFocus would open the tip and
        // leave the click handler to immediately close it again — the tip
        // would flash and never stay on exactly the devices the click toggle
        // is here for.
        onFocus={(e) => e.target.matches(":focus-visible") && show()}
        onBlur={hide}
        className="text-subtle hover:text-foreground focus-visible:text-foreground inline-flex shrink-0 cursor-help transition-colors outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {rect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            style={{
              left,
              width: TIP_WIDTH,
              ...(flip
                ? { bottom: window.innerHeight - rect.top + 8 }
                : { top: below }),
            }}
            className="rounded-container border-border bg-surface shadow-pop pointer-events-none fixed z-50 border px-3.5 py-3"
          >
            <p className="heading-14 text-foreground mb-2">{title}</p>
            <ul className="text-muted flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
              {points.map((point) => (
                <li key={point} className="flex gap-2">
                  <span className="bg-border-strong mt-[7px] h-1 w-1 shrink-0 rounded-full" />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
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
  // Uncontrolled rows still need the box to react to a click, so visual
  // state is mirrored locally; the input stays the source of truth.
  const [on, setOn] = useState(Boolean(checked ?? defaultChecked));

  return (
    // `relative` is load-bearing: the sr-only input is `position: absolute`,
    // so without a positioned ancestor it lands at the nearest one — clicking
    // the row scrolled the form's scroll port as the browser brought the
    // newly focused input into view. Toolkit tiles already carried this.
    <label
      className={`rounded-control border-border has-[:focus-visible]:outline-foreground relative flex items-start gap-2.5 border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
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
