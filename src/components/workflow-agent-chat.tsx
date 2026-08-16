"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkflowFormValues } from "@/components/workflow-form";
import {
  ArrowUp,
  Sparkles,
  RotateCcw,
  TriangleAlert,
  Clock,
  Cpu,
  Wrench,
  Globe,
  Puzzle,
  Search,
  Plug,
  Check,
  ChevronsUpDown,
  PenLine,
} from "lucide-react";
import { buttonClass, iconButtonClass } from "@/components/ui";
import { ModelPicker } from "@/components/model-picker";
import { TOOLKIT_ICONS } from "@/lib/toolkit-labels";
import type { ToolkitOption } from "@/components/workflow-form";
import type { ModelInfo } from "@/lib/model-tiers";
import { defaultBuilderModel, isBuilderModel } from "@/lib/builder-models";
import { fetchJson } from "@/lib/fetch-json";
import { Markdown } from "@/components/markdown";
import { useAutosize } from "@/components/markdown-editor";

/** Module-level so the picker's `include` prop keeps a stable identity. */
const isBuilderModelInfo = (model: ModelInfo) => isBuilderModel(model.id);

// The agent proposes the basics; everything it doesn't decide (delivery
// destinations, tool filters, event triggers) keeps the form's own defaults.
type Proposal = Partial<WorkflowFormValues> & {
  /** Tools the assistant actually called while researching this proposal. */
  usedTools?: string[];
};

/**
 * A turn is a chat reply that may or may not carry a spec — `spec: null`
 * means it asked a clarifying question instead of committing.
 */
type ProposeResponse = {
  reply: string;
  spec: Partial<WorkflowFormValues> | null;
  usedTools?: string[];
};

type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      spec?: Proposal;
      /** Shown on question turns too, where there is no spec to hang it off. */
      usedTools?: string[];
    };

/** Always offered: web search needs no connected account. */
const WEB_SEARCH: ToolkitOption = {
  slug: "composio_search",
  name: "Web search",
};

const EXAMPLES = [
  "Every weekday 8am, check my calendar and DM me a heads up on Slack",
  "Friday 5pm, summarize the GitHub issues assigned to me this week",
  "Every morning, flag unread Gmail threads that look urgent",
];

/**
 * The left pane of the new-workflow screen: a conversation that writes the
 * form on the right. Keeps the turn history plus the last proposed spec and
 * sends both to /api/workflows/propose, so "make it hourly" edits that spec
 * instead of starting fresh.
 */
export function WorkflowAgentChat({
  onPropose,
  models = [],
  availableToolkits = [],
  initialSpec = null,
}: {
  onPropose: (values: Proposal) => void;
  /** Gateway catalog for the header picker — the same list the form uses. */
  models?: ModelInfo[];
  /** Connected apps the assistant may be allowed to read from. */
  availableToolkits?: ToolkitOption[];
  /**
   * The workflow being edited, if any. Seeds `current` so the first message
   * refines this spec instead of drafting from nothing — otherwise a bare
   * "make it hourly" would read as building a new workflow around one field.
   */
  initialSpec?: Partial<WorkflowFormValues> | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Proposal | null>(initialSpec);
  const [builderModel, setBuilderModel] = useState(() =>
    defaultBuilderModel(models),
  );
  // Apps the assistant may read from while drafting. Empty by default since a
  // lookup costs a round trip to a real inbox. Editing preselects apps
  // already used.
  const [readToolkits, setReadToolkits] = useState<Set<string>>(
    () => new Set(initialSpec?.toolkits ?? []),
  );
  // Whether the drafted workflow may call write tools at runtime. Off by
  // default, matching the form's checkbox (writes here via the proposed
  // spec's `readOnly`); editing starts from the saved permission instead.
  const [allowWrites, setAllowWrites] = useState(
    () => initialSpec?.readOnly === false,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // 160px — same ceiling as the old `max-h-40`, now a range instead of a
  // fixed three rows.
  const composerRef = useAutosize(draft, 160);

  const connectors = [WEB_SEARCH, ...availableToolkits];

  function toggleToolkit(slug: string) {
    setReadToolkits((prev) => {
      const next = new Set(prev);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });
  }

  // Pin to the newest turn (including the pending bubble) so the user sees
  // their message landed.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setLoading(true);
    setError(null);

    try {
      // fetchJson, not `res.json()`/`res.ok`: an auth redirect or platform
      // error answers with HTML, which used to surface as "Unexpected token '<'".
      const data = await fetchJson<ProposeResponse>("/api/workflows/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          current,
          builderModel,
          readToolkits: [...readToolkits],
          allowWrites,
        }),
      });

      // A clarifying turn leaves the form alone — only a committed spec
      // writes into it, so half-answered questions can't half-fill the workflow.
      const spec: Proposal | undefined = data.spec
        ? { ...data.spec, usedTools: data.usedTools }
        : undefined;
      if (spec) {
        onPropose(spec);
        // Without usedTools: `current` gets echoed back to the model as the
        // spec it's refining, and research trivia isn't part of the spec.
        setCurrent(data.spec);
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          spec,
          usedTools: data.usedTools,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    // Back to the saved workflow, not blank — "Reset" clears the chat, not
    // the thing being edited.
    setCurrent(initialSpec);
    setError(null);
    setDraft("");
  }

  const empty = messages.length === 0;

  return (
    <div className="rounded-container border-border bg-surface flex h-full min-h-0 flex-col overflow-hidden border">
      {/* px-4 matches the message column and composer below it, giving the
          card one left edge top to bottom. */}
      <div className="border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-control border-border bg-bg-subtle text-foreground flex h-7 w-7 items-center justify-center border">
            <Sparkles className="h-4 w-4" />
          </span>
          {/* "Builder", not "Assistant": the pane's job is to build the
              workflow beside it. Goes screen-reader-only on narrow panes,
              where the controls need the room. */}
          <span className="heading-14 text-foreground max-sm:sr-only">
            Workflow Builder
          </span>
        </div>
        {/*
         * Two controls here, not four: the old bar had all four `shrink-0` on
         * one line and they collided once the pane narrowed. What's left
         * belongs to the *session* (which apps the builder reads, Reset); the
         * two that belong to the *message* (write permission, drafting model)
         * moved onto the composer.
         */}
        <div className="flex min-w-0 items-center gap-1.5">
          {connectors.length > 0 && (
            <ConnectorPicker
              connectors={connectors}
              selected={readToolkits}
              onToggle={toggleToolkit}
              onClear={() => setReadToolkits(new Set())}
            />
          )}
          {!empty && (
            <>
              <span className="bg-border h-5 w-px shrink-0" />
              <button
                type="button"
                onClick={reset}
                className={buttonClass(
                  "ghost",
                  "sm",
                  "-mr-2 shrink-0 gap-1 px-2",
                )}
                title="Start over"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {/* The pane is wide; the column inside it stays a readable width. Turns
            hug the composer the way every chat does — the empty pitch centers. */}
        <div
          className={`mx-auto flex min-h-full w-full max-w-[680px] flex-col ${
            empty ? "justify-center" : "justify-end"
          }`}
        >
          {empty ? (
            <div className="flex flex-col">
              {/* "on the right" is only true from `lg` up — below that the
                  form stacks under this pane, with no column to point to. */}
              <p className="text-muted text-sm leading-relaxed">
                Say what should happen, and when. I&apos;ll fill in the
                schedule, apps and prompt{" "}
                <span className="lg:hidden">below</span>
                <span className="hidden lg:inline">on the right</span>, and you
                can change any of it before saving.
              </p>
              <div className="mt-4 flex flex-col gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="rounded-control border-border bg-bg-subtle text-muted hover:border-border-strong hover:text-foreground cursor-pointer border px-3 py-2 text-left text-[13px] leading-snug transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message, i) =>
                message.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="rounded-container bg-solid text-solid-fg max-w-[85%] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex flex-col gap-2">
                    {/* Builder answers in markdown (lists, `code` for tool
                        slugs, tables); pre-wrapped text showed it as source.
                        User turns stay verbatim. */}
                    <div className="rounded-container border-border bg-bg-subtle text-foreground max-w-[92%] border px-3 py-2">
                      <Markdown size="sm">{message.content}</Markdown>
                    </div>
                    {(message.usedTools?.length ?? 0) > 0 && (
                      <p className="text-subtle flex items-start gap-1.5 text-[11px]">
                        <Search className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono break-all">
                          {message.usedTools!.join(", ")}
                        </span>
                      </p>
                    )}
                    {message.spec && <SpecSummary spec={message.spec} />}
                  </div>
                ),
              )}

              {loading && <PendingTurn reading={readToolkits.size > 0} />}
            </div>
          )}

          {error && (
            <p className="rounded-control border-danger-soft bg-danger-soft text-danger-text mt-3 flex items-start gap-1.5 border px-2.5 py-2 text-[13px]">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="border-border shrink-0 border-t px-4 py-3"
      >
        <div className="rounded-container border-border bg-bg focus-within:border-border-strong mx-auto flex w-full max-w-[680px] flex-col gap-1.5 border p-1.5 transition-colors">
          <textarea
            // Grows with the message instead of a fixed three rows.
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — standard chat convention.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder={
              empty
                ? "Every weekday morning, check my calendar…"
                : current
                  ? "Refine it — “make it hourly”"
                  : "Answer, or say “you decide”"
            }
            disabled={loading}
            aria-label="Describe the workflow"
            className="text-foreground placeholder:text-subtle min-h-0 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-relaxed outline-none disabled:opacity-60"
          />

          {/*
           * Composer toolbar: both controls sit against Send as one cluster
           * since both describe the message being sent. `justify-end` +
           * `flex-wrap` lets them drop to their own line on a narrow pane
           * instead of colliding.
           *
           * The chip carries a muted prefix ("Workflow"), like the header's
           * ("Builder") — otherwise "read-only" doesn't say for whom. Prefix
           * drops below `sm`, where the value alone carries it.
           */}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {/* What the *saved workflow* may do on every run; rides to the API
                so the spec is written for an agent that can act, and lands in
                the form as the same flag its own checkbox sets. */}
            <button
              type="button"
              onClick={() => setAllowWrites((v) => !v)}
              aria-pressed={allowWrites}
              title={
                allowWrites
                  ? "When it runs, this workflow can post, send and update in your connected apps. It can never delete."
                  : "When it runs, this workflow only reads — plus whatever delivering the digest needs."
              }
              className={`rounded-control flex h-8 shrink-0 cursor-pointer items-center gap-1.5 border px-3 text-xs font-medium transition-colors ${
                allowWrites
                  ? "border-foreground bg-surface-2 text-foreground"
                  : "border-border text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              <PenLine className="h-3.5 w-3.5 shrink-0" />
              <span className="text-subtle font-normal max-sm:hidden">
                Workflow
              </span>
              <span>{allowWrites ? "write tools allowed" : "read-only"}</span>
            </button>

            {/* Which model does the *building*, not the model it picks for
                the workflow (the form owns that). Same dialog, narrowed to
                models that can hold the conversation and emit a valid spec. */}
            <ModelPicker
              name={null}
              variant="compact"
              value={builderModel}
              onChange={setBuilderModel}
              initialModels={models}
              include={isBuilderModelInfo}
            />

            <button
              type="submit"
              disabled={loading || !draft.trim()}
              aria-label="Send"
              className={iconButtonClass("primary", "sm", "h-9 w-9")}
            >
              <ArrowUp className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/*
 * Phases, with the second they start at. The API answers in one shot — no
 * real progress to report — so these are a clock, not a trace: each line only
 * claims what's *known* to be happening by then, and the last admits it's
 * still waiting rather than inventing a fifth step. Reading from connected
 * apps adds a real round trip, so that path gets its own, slower script.
 */
const PHASES_LOCAL: Array<[number, string]> = [
  [0, "Reading your request…"],
  [3, "Working out the schedule and tools…"],
  [9, "Drafting the workflow…"],
  [22, "Still working — this one's taking a while…"],
];

const PHASES_READING: Array<[number, string]> = [
  [0, "Reading your request…"],
  [3, "Looking through your apps…"],
  [12, "Drafting the workflow from what it found…"],
  [30, "Still working — big inboxes take a while…"],
];

/**
 * The assistant's turn while in flight. Shaped like the bubble that will
 * replace it (same border, wash, radius) so the reply lands in place instead
 * of the column jumping. Elapsed counter appears only past 6s, once the wait
 * starts feeling like a hang.
 */
function PendingTurn({ reading }: { reading: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const phases = reading ? PHASES_READING : PHASES_LOCAL;
  const label = phases.reduce(
    (acc, [at, text]) => (elapsed >= at ? text : acc),
    phases[0][1],
  );

  return (
    <div
      // `w-fit`, not full-width: the reply that replaces it is a bubble
      // hugging its text, and a stretched pending bar read as a different
      // kind of object.
      className="rounded-container border-border bg-bg-subtle flex w-fit max-w-[92%] items-center gap-2.5 border px-3 py-2"
      role="status"
      aria-live="polite"
    >
      <span className="text-subtle relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      {/* `key` on the label so a phase change re-runs the rise — the only
          signal the wait moved on. */}
      <span
        key={label}
        className="rise text-shimmer min-w-0 truncate text-[13px]"
      >
        {label}
      </span>
      {elapsed >= 6 && (
        <span className="text-subtle shrink-0 font-mono text-[11px] tabular-nums">
          {elapsed}s
        </span>
      )}
    </div>
  );
}

/**
 * Apps the assistant may read from while drafting. A dropdown, not chips: the
 * catalog is open-ended (every linked Composio app shows up), so it must stay
 * one control wide and be searchable past a handful.
 */
function ConnectorPicker({
  connectors,
  selected,
  onToggle,
  onClear,
}: {
  connectors: ToolkitOption[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // The panel is anchored to the trigger's viewport box, so it must follow —
    // both the chat pane and the page scroll under it.
    const reposition = () =>
      setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = connectors.filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q),
  );

  const count = selected.size;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setRect(triggerRef.current?.getBoundingClientRect() ?? null);
          setQuery("");
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Apps I may look inside while we talk, so the draft fits your real calendar, inbox or repos. I only read."
        className={`rounded-control flex h-8 shrink-0 cursor-pointer items-center gap-1.5 border px-3 text-xs font-medium transition-colors ${
          count > 0
            ? "border-foreground bg-surface-2 text-foreground"
            : "border-border text-muted hover:border-border-strong hover:text-foreground"
        }`}
      >
        <Plug className="h-3.5 w-3.5 shrink-0" />
        <span className="text-subtle font-normal max-sm:hidden">Builder</span>
        <span>{count > 0 ? `reads ${count}` : "reads nothing"}</span>
        <ChevronsUpDown className="text-subtle h-3.5 w-3.5 shrink-0" />
      </button>

      {/* Portalled like the model picker: the chat card clips overflow, and
          the form column is a `@container`. */}
      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              role="dialog"
              aria-label="Apps the builder may read while drafting"
              className="rounded-container border-border bg-surface shadow-pop fixed z-50 flex w-[260px] flex-col overflow-hidden border"
              style={{
                // Trigger sits at the bottom of the pane, so a panel that
                // always dropped down would open off the window. Flips above
                // when that side is taller, and sizes to whatever room's
                // there rather than a fixed 380.
                ...(() => {
                  const GAP = 6;
                  const EDGE = 8;
                  const below = window.innerHeight - rect.bottom - GAP - EDGE;
                  const above = rect.top - GAP - EDGE;
                  const up = above > below;
                  const room = Math.max(160, up ? above : below);
                  return {
                    maxHeight: Math.round(Math.min(room, 380)),
                    ...(up
                      ? {
                          bottom: Math.round(
                            window.innerHeight - rect.top + GAP,
                          ),
                        }
                      : { top: Math.round(rect.bottom + GAP) }),
                  };
                })(),
                // Right-aligned to the trigger, clamped so a narrow viewport
                // can't push it off-screen.
                left: Math.round(
                  Math.max(
                    8,
                    Math.min(rect.right - 260, window.innerWidth - 268),
                  ),
                ),
              }}
            >
              <div className="border-border flex items-center gap-2 border-b px-3 py-2">
                <Search className="text-subtle h-3.5 w-3.5 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search apps…"
                  className="text-foreground placeholder:text-subtle min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                  <p className="text-subtle px-3 py-3 text-xs">
                    No app matches that.
                  </p>
                ) : (
                  visible.map((toolkit) => {
                    const on = selected.has(toolkit.slug);
                    const Fallback = TOOLKIT_ICONS[toolkit.slug] ?? Puzzle;
                    return (
                      <button
                        key={toolkit.slug}
                        type="button"
                        onClick={() => onToggle(toolkit.slug)}
                        aria-pressed={on}
                        className={`border-border flex w-full cursor-pointer items-center gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0 ${
                          on ? "bg-surface-2" : "hover:bg-surface-hover"
                        }`}
                      >
                        {toolkit.slug === WEB_SEARCH.slug ? (
                          <Globe className="text-subtle h-4 w-4 shrink-0" />
                        ) : toolkit.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={toolkit.logo}
                            alt=""
                            className="h-4 w-4 shrink-0 rounded-[3px] object-contain"
                          />
                        ) : (
                          <Fallback className="text-subtle h-4 w-4 shrink-0" />
                        )}
                        <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
                          {toolkit.name}
                        </span>
                        {on && (
                          <Check className="text-foreground h-4 w-4 shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-border bg-bg-subtle flex items-center justify-between gap-2 border-t px-3 py-2">
                {/* Worth saying once: ticking an app hands over read access
                    to a real account. */}
                <span className="text-subtle text-[11px]">
                  Looks, never touches
                </span>
                <button
                  type="button"
                  onClick={onClear}
                  disabled={count === 0}
                  className="text-muted hover:text-foreground cursor-pointer text-[11px] font-medium disabled:cursor-default disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** What the assistant just wrote into the form, at a glance. */
function SpecSummary({ spec }: { spec: Proposal }) {
  const items: Array<{
    icon: React.ComponentType<{ className?: string }>;
    text: string;
  }> = [
    { icon: Clock, text: `${spec.cron} · ${spec.timezone}` },
    { icon: Wrench, text: (spec.toolkits ?? []).join(", ") },
    { icon: Cpu, text: spec.model ?? "" },
  ];

  // Only worth a line when it's the non-default, riskier setting.
  if (spec.readOnly === false) {
    items.push({ icon: PenLine, text: "write tools allowed" });
  }

  return (
    <div className="rounded-container border-border flex flex-col gap-1 border px-3 py-2">
      <span className="text-foreground text-[13px] font-medium">
        {spec.name}
      </span>
      {items.map(({ icon: Icon, text }) => (
        <span
          key={text}
          className="text-muted flex items-center gap-1.5 text-xs"
        >
          <Icon className="text-subtle h-4 w-4 shrink-0" />
          <span className="truncate font-mono">{text}</span>
        </span>
      ))}
    </div>
  );
}
