"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronRight,
  Check,
  Copy,
} from "lucide-react";
import { buttonClass } from "@/components/ui";

/*
 * What a log viewer needs and a bare <details> list doesn't have: one switch
 * for every row, a way to get a payload out, and a way to read a payload that
 * JSON escaping has made unreadable.
 *
 * The step rows themselves stay server-rendered — their markdown and their
 * status lines are HTML by the time they reach the browser, and lifting all of
 * that into a client tree would mean sending it twice. Only the payload blocks
 * are client, because switching view and copying are both state.
 */

/** Opens or closes every step in the trace. `scope` is a DOM id on the list. */
export function TraceToggleAll({ scope }: { scope: string }) {
  // Tracks what the button will *do* next, not what the rows currently are: a
  // row the user opened by hand doesn't flip the meaning of this control.
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    const root = document.getElementById(scope);
    // Step rows only. Each row's args and result are <details> of their own,
    // and folding those is a decision per payload — "expand all" means every
    // step is visible, not that every payload is unrolled.
    for (const el of root?.querySelectorAll(":scope > li > details") ?? []) {
      (el as HTMLDetailsElement).open = next;
    }
    setExpanded(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={buttonClass("ghost", "sm", "gap-1.5")}
    >
      {expanded ? (
        <ChevronsDownUp className="h-3.5 w-3.5" />
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5" />
      )}
      {expanded ? "Collapse all" : "Expand all"}
    </button>
  );
}

/**
 * Copies a payload to the clipboard. The text is passed in rather than read
 * back out of the <pre>, so what lands on the clipboard is the exact string the
 * server serialized — not a copy that picked up the panel's wrapping.
 */
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Guarded because this can sit inside a <summary>, where a plain click would
  // also fold the block — copying is not a request to close anything.
  const copy = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied (insecure origin, or the user said no). The
      // payload is on screen and selectable either way.
    }
  };

  return (
    // Icon only. It repeats once per payload down a long trace, and a row of
    // "Copy args" chips competes with the payloads themselves for the eye. The
    // label survives in the tooltip and the accessible name, where a screen
    // reader still hears which of the two blocks it belongs to.
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `${label} to clipboard`}
      aria-label={`${label} to clipboard`}
      className="border-border text-subtle hover:bg-surface-hover hover:text-foreground inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border transition-colors"
    >
      {copied ? (
        <Check className="text-success-text h-3 w-3" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/**
 * Above this many lines a payload starts collapsed. Short ones are worth
 * reading at a glance; a long one otherwise buries the next step behind a
 * scroll box nobody asked for.
 */
const FOLD_LINES = 12;

/**
 * A one-line payload this short is rendered as a row rather than a fold. Half
 * the tool calls in a trace have args like `{"channel":"#ops"}` or a result of
 * `null`, and a disclosure triangle in front of that asks the reader to open
 * something already fully on screen.
 */
const INLINE_CHARS = 56;

/** How tall a payload may get before it scrolls inside its own box. */
const VIEW_MAX_HEIGHT = "max-h-[18rem]";

/**
 * One `args` or `result` block in the trace.
 *
 * Two views where the payload has both. JSON is the shape — what the tool was
 * handed, what came back, nesting intact. Text is the same content with the
 * escaping undone, which is the only readable form of a tool that answers in
 * prose. The tabs appear only when there is a second view to switch to.
 *
 * Copy lives on the block's own toolbar rather than the summary line: it acts
 * on what is being shown, so it belongs next to the switch that decides that,
 * and the summary line goes back to being a label and a size.
 */
export function PayloadView({
  label,
  json,
  text,
  size,
}: {
  label: string;
  /** The payload serialized as pretty JSON. Always present. */
  json: string;
  /** Its plain-text reading, when it has one. */
  text: string | null;
  /** Preformatted byte size of the JSON view. */
  size: string;
}) {
  const [view, setView] = useState<"json" | "text">("json");
  const shown = view === "text" && text != null ? text : json;
  const lines = json.split("\n").length;

  if (lines === 1 && json.length <= INLINE_CHARS && text == null) {
    return (
      // The empty span holds the chevron column, so an inline row's tag starts
      // on the same x as a folded one's.
      <div className="flex items-center gap-2">
        <span className="w-3 shrink-0" />
        <PayloadTag label={label} />
        <span className="text-foreground min-w-0 flex-1 truncate">{json}</span>
        <CopyButton text={json} label={`Copy ${label}`} />
      </div>
    );
  }

  return (
    <details className="group/payload" open={lines <= FOLD_LINES}>
      <summary className="hover:bg-surface-hover -mx-1 flex cursor-pointer list-none items-center gap-2 rounded-[5px] px-1 py-0.5 transition-colors">
        <ChevronRight className="text-subtle h-3 w-3 shrink-0 transition-transform group-open/payload:rotate-90" />
        <PayloadTag label={label} />

        {/* Closed, the row previews the payload; open, the space is simply
            left empty — a rule through it only drew a line to nowhere. */}
        <span className="text-muted min-w-0 flex-1 truncate group-open/payload:hidden">
          {json.replace(/\s+/g, " ").trim()}
        </span>
        <span className="hidden flex-1 group-open/payload:block" />

        <span className="text-subtle shrink-0 text-[10px] tabular-nums">
          {lines} lines · {size}
        </span>
        {/* On the header, so a closed block can be copied without unfolding
            it. It still copies whichever view is selected below. */}
        <CopyButton
          text={shown}
          label={`Copy ${label}${text != null && view === "text" ? " as text" : ""}`}
        />
      </summary>

      <div className="rounded-control border-border bg-surface mt-1.5 overflow-hidden border">
        {/* Only earns a toolbar when there is something to switch between. */}
        {text != null && (
          <div className="border-border bg-bg-subtle flex items-center gap-1 border-b px-1.5 py-1">
            <ViewTab active={view === "json"} onClick={() => setView("json")}>
              JSON
            </ViewTab>
            <ViewTab active={view === "text"} onClick={() => setView("text")}>
              Text
            </ViewTab>
          </div>
        )}
        {/* `whitespace-pre-wrap` in the text view: prose has no meaningful
            column width, so wrapping it beats a horizontal scrollbar. JSON
            keeps its indentation and scrolls sideways instead. */}
        <pre
          className={`text-foreground ${VIEW_MAX_HEIGHT} overflow-auto px-2.5 py-2 ${
            view === "text" ? "whitespace-pre-wrap" : ""
          }`}
        >
          {shown}
        </pre>
      </div>
    </details>
  );
}

/** The `ARGS` / `RESULT` tag. Same width in both, so the two rows line up. */
function PayloadTag({ label }: { label: string }) {
  return (
    <span className="text-subtle w-12 shrink-0 text-[10px] font-medium tracking-wider uppercase">
      {label}
    </span>
  );
}

/** One tab in the payload's view switch. */
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-5 cursor-pointer rounded-[4px] px-1.5 text-[10px] font-medium tracking-wide uppercase transition-colors ${
        active
          ? "bg-surface-2 text-foreground"
          : "text-subtle hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
