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
 * Adds what a bare <details> list lacks: expand/collapse all, copy-out, and a
 * readable view of JSON-escaped payloads.
 *
 * Step rows stay server-rendered (their markdown/status lines are already
 * HTML, so a client tree would just resend them). Only the payload blocks are
 * client, since view-switching and copying are state.
 */

/** Opens or closes every step in the trace. `scope` is a DOM id on the list. */
export function TraceToggleAll({ scope }: { scope: string }) {
  // Tracks what the button will do next, not the rows' current state, so a
  // manually-opened row doesn't flip the control's meaning.
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    const root = document.getElementById(scope);
    // Step rows only — each row's args/result are their own <details>, and
    // "expand all" means every step visible, not every payload unrolled.
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
 * Copies a payload to the clipboard. Text is passed in rather than read back
 * out of the <pre>, so it's the exact string the server serialized, not one
 * that picked up the panel's wrapping.
 */
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Guarded: this can sit inside a <summary>, where a plain click would also
  // fold the block — copying isn't a request to close anything.
  const copy = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (insecure origin, or user said no); payload is still
      // on screen and selectable.
    }
  };

  return (
    // Icon only: it repeats per payload down a long trace, and "Copy args"
    // chips would compete with the payloads for the eye. Label survives in
    // the tooltip and accessible name.
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
 * Above this many lines a payload starts collapsed, so a long one doesn't
 * bury the next step behind an unwanted scroll box.
 */
const FOLD_LINES = 12;

/**
 * A one-line payload this short renders as a row, not a fold — a disclosure
 * triangle in front of `{"channel":"#ops"}` or `null` just asks the reader to
 * open something already fully visible.
 */
const INLINE_CHARS = 56;

/** How tall a payload may get before it scrolls inside its own box. */
const VIEW_MAX_HEIGHT = "max-h-[18rem]";

/**
 * One `args` or `result` block in the trace.
 *
 * Two views where the payload has both: JSON keeps the shape (nesting
 * intact), text is the same content with escaping undone — the only readable
 * form for a tool that answers in prose. Tabs appear only when there's a
 * second view to switch to.
 *
 * Copy lives on the block's own toolbar, not the summary line, since it acts
 * on whatever's currently shown.
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
      // Empty span holds the chevron column, so an inline row's tag lines up
      // with a folded one's.
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

        {/* Closed: previews the payload. Open: left empty — a rule through it
            just drew a line to nowhere. */}
        <span className="text-muted min-w-0 flex-1 truncate group-open/payload:hidden">
          {json.replace(/\s+/g, " ").trim()}
        </span>
        <span className="hidden flex-1 group-open/payload:block" />

        <span className="text-subtle shrink-0 text-[10px] tabular-nums">
          {lines} lines · {size}
        </span>
        {/* On the header so a closed block can be copied without unfolding;
            still copies whichever view is selected below. */}
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
        {/* `whitespace-pre-wrap` in text view: prose has no meaningful column
            width, so wrapping beats a horizontal scrollbar. JSON keeps its
            indentation and scrolls sideways instead. */}
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
