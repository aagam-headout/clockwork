import type { ToolSet } from "ai";
import { createQueryTool } from "./query";
import { createInspectTool } from "./inspect";
import { createReportTool } from "./report";
import { createHistoryTool } from "./history";
import type { SystemToolContext } from "./context";

export type { SystemToolContext } from "./context";

/*
 * A workflow's tools come from two places:
 *
 * - Connector tools come from whatever integration a workflow uses
 *   (Composio, MCP, ...). They vary per workflow, and `wrap-tools.ts` wraps
 *   them generically without knowing their names in advance.
 * - System tools are engine-owned and present on every run regardless of
 *   connectors. `query`/`inspect` read a payload a connector tool produced;
 *   `report` ends the run — the only way a run produces an outcome.
 *
 * A future system tool is one more file here plus one more entry below —
 * `wrap-tools.ts` never needs to change to gain one.
 */
export const SYSTEM_TOOL_NAMES = [
  "query",
  "inspect",
  "report",
  "history",
] as const;

/**
 * @param handles whether the handle harness is on for this run.
 *
 * `query`/`inspect` only mean anything when results are replaced by
 * descriptors, so `HANDLES_ENABLED=false` drops them. `report` stays regardless
 * — it's how a run produces an outcome at all, so disabling the harness must
 * not remove it.
 */
export function buildSystemTools(
  ctx: SystemToolContext,
  { handles }: { handles: boolean },
): ToolSet {
  /*
   * `report` and `history` have nothing to do with descriptors, so both stay
   * on when the handle harness is off — only the two payload-reading tools go.
   */
  const always = {
    report: createReportTool(ctx),
    history: createHistoryTool(ctx),
  };
  if (!handles) return always;

  return {
    query: createQueryTool(ctx),
    inspect: createInspectTool(ctx),
    ...always,
  };
}

/** Appended to the system prompt, and static so it is the same text every run. */
export const HANDLE_PROMPT = `Most tool results come back to you in full, as ordinary values — use them
directly. Only a LARGE result is replaced by a descriptor: an object with a
"handle" field like "r1", plus the payload's shape, its size, a short sample,
and usually "preview_rows" — the first few entries of its main list, in full.
If preview_rows already answers the goal, write the digest from it.

A handle exists only if you were given one in a descriptor you can see in this
conversation. Never guess or invent a handle: if the result you want to read
came back in full, it is already in front of you, and calling query on a made-up
handle wastes the run. When a descriptor is present, the full payload is held
for this run and you read it with two tools:

- query({handle, path, pick, where, sort, take, count, offset}) — returns only
  the fields and rows you ask for. \`where\` supports equals, contains, after,
  before. A long text or a long list comes back in pages: re-call with the same
  \`offset\` plus the returned page size while the reply says "truncated": true.
- inspect({handle, path}) — returns shape and a sample only, for when you need
  the field names before you can pick them.

Neither makes an external call, and neither spends your step budget. Each one
is still a round trip that re-sends this conversation, so plan them: one or two
per handle, aimed at what the goal needs, rather than exploring.

If a descriptor carries "unchanged_since", the tool ran this run and returned
data byte-identical to the previous run's. That is live evidence of no change —
report it as unchanged and do not query it again to confirm.`;

/** Appended to the system prompt. Static, so it stays cacheable. */
export const REPORT_PROMPT = `You finish this run by calling report(...) exactly once, as your final
action. Nothing you write outside that call is delivered to anyone.

- report({digest}) — the markdown digest a human will skim on a phone.
- report({no_updates: true}) — nothing changed since the previous digest.
  Send no digest. Silence is better than a digest that says "no updates".
- report({digest, signals}) — when signals are listed in your instructions,
  fill every one you measured. They are compared against thresholds after the
  run, so a signal you leave out is a threshold that cannot be checked.
- report({digest, severity}) — "info", "warn" or "critical", your own read.

report is a tool call and only a tool call. Never write it out as text, XML or
JSON in your message — a <report> block you type is not a report, and a run
that ends without the call is recorded as failed. Do not narrate your progress
or reasoning in the message either; the digest goes in the call, and everything
else you write is thrown away.

If report returns an error, read it, fix the argument, and call it again.`;

/** Appended to the system prompt. Static, so it stays cacheable. */
export const HISTORY_PROMPT = `You can read your own past digests for this workflow with
history({q, since, scope, limit}). It does not spend your step budget, and it
is the only way to tell a one-off from a pattern — the digest you are shown in
the prompt is just the most recent one.

Use it when the goal involves a trend, a recurrence, or "again", and when you
need to check whether you already reported something. Two calls is usually
plenty; you have a small budget and the run is not an investigation.`;
