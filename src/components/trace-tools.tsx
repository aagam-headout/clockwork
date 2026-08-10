"use client";

import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/ui";

/*
 * The two things a log viewer needs and a bare <details> list doesn't have:
 * one switch for every row, and a way to get the payload out.
 *
 * Both work on the rendered DOM rather than on React state. The trace is a
 * server component — the steps, their JSON and their markdown are all HTML by
 * the time they reach the browser — so lifting the open/closed state of every
 * row into a client tree would mean sending all of it twice.
 */

/** Opens or closes every step in the trace. `scope` is a DOM id on the list. */
export function TraceToggleAll({ scope }: { scope: string }) {
  // Tracks what the button will *do* next, not what the rows currently are: a
  // row the user opened by hand doesn't flip the meaning of this control.
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    const root = document.getElementById(scope);
    for (const el of root?.querySelectorAll("details") ?? []) {
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
 * back out of the <pre>, so what lands on the clipboard is the exact JSON the
 * server serialized — not a copy that picked up the panel's wrapping.
 */
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
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
    <button
      type="button"
      onClick={copy}
      title={`${label} to clipboard`}
      aria-label={`${label} to clipboard`}
      // Sits inside the pinned-dark log panel, so its colours are fixed the
      // same way the panel's are rather than following the site theme.
      className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[5px] border border-[#30363d] px-1.5 text-[10px] font-medium text-[#8b949e] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[#c9d1d9]"
    >
      {copied ? (
        <Check className="h-3 w-3 text-[#3fb950]" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
