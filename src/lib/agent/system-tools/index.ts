import type { ToolSet } from "ai";
import { createQueryTool } from "./query";
import { createInspectTool } from "./inspect";
import type { SystemToolContext } from "./context";

export type { SystemToolContext } from "./context";

/*
 * A workflow's tools come from two different places, and the distinction
 * matters for onboarding a new one:
 *
 * - Connector tools come from whatever integration a workflow uses
 *   (Composio, MCP, ...). They vary per workflow, and `wrap-tools.ts` wraps
 *   them generically without knowing their names in advance.
 * - System tools are engine-owned: the same `query`/`inspect` pair, present
 *   on every run regardless of which connectors it uses, for reading a
 *   payload a connector tool produced.
 *
 * A future system tool is one more file here plus one more entry below —
 * `wrap-tools.ts` never needs to change to gain one.
 */
export const SYSTEM_TOOL_NAMES = ["query", "inspect"] as const;

export function buildSystemTools(ctx: SystemToolContext): ToolSet {
  return {
    query: createQueryTool(ctx),
    inspect: createInspectTool(ctx),
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
