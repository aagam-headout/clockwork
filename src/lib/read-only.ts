/**
 * Read-only enforcement gate. This runs server-side, before any tool
 * schema reaches the model — the agent never even sees a write tool it
 * wasn't explicitly granted via a workflow's `deliver` targets.
 */

// Read-verb tool slugs, e.g. GITHUB_LIST_REPOS, GMAIL_FETCH_EMAILS,
// SLACK_LIST_CHANNELS. Composio slugs are SCREAMING_SNAKE, verb usually
// appears as its own segment.
const READ_VERB = /(^|_)(GET|LIST|SEARCH|FETCH|READ|RETRIEVE|FIND|QUERY)(_|$)/;

/*
 * Write verbs, checked *after* the read verbs and given priority over them.
 * Plenty of real slugs carry both — GITHUB_GET_OR_CREATE_..., NOTION_
 * SEARCH_AND_UPDATE_... — and a read verb anywhere in the name used to be
 * enough to let those through. Deny wins, so a mixed slug is treated as a
 * write.
 *
 * This is still name-based inference. The stronger check is Composio's own
 * per-tool metadata, but the AI-SDK tool objects returned by
 * `composio.tools.get` don't carry it, so the slug is what we have.
 */
const WRITE_VERB =
  /(^|_)(CREATE|UPDATE|DELETE|REMOVE|SEND|POST|PUT|PATCH|ADD|SET|EDIT|WRITE|UPLOAD|INSERT|APPEND|MOVE|ARCHIVE|CLOSE|MERGE|ASSIGN|INVITE|MARK|REPLY|TRASH|DRAFT|CANCEL|APPROVE|REVOKE|SHARE|RENAME|DUPLICATE|CLEAR|RESET|ENABLE|DISABLE|EXECUTE|RUN)(_|$)/;

// Composio's built-in search toolkit needs no auth and is read-only by
// construction — always allow it regardless of a workflow's toolkit list.
const ALWAYS_ALLOWED_PREFIXES = ["COMPOSIO_SEARCH_"];

export function isReadOnlyToolSlug(slug: string): boolean {
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => slug.startsWith(p))) return true;
  if (WRITE_VERB.test(slug)) return false;
  return READ_VERB.test(slug);
}

/**
 * Delivery targets a workflow can declare. Each maps to the one write tool
 * slug it's allowed to use (or to no tool at all, when the executor delivers
 * it directly), so the model can't redirect output anywhere else.
 */
export type DeliverTarget =
  | { type: "dashboard" } // no tool call — executor persists the output row
  | { type: "slack_dm" } // SLACK_SEND_MESSAGE, to your own DM
  | { type: "slack_channel"; channel: string }
  | { type: "email"; to: string } // GMAIL_SEND_EMAIL
  | { type: "webhook"; url: string }; // executor POSTs it, no tool involved

export type DeliverType = DeliverTarget["type"];

/** Targets the *model* delivers, by calling exactly this tool. */
export const DELIVER_TOOL_SLUGS: Partial<Record<DeliverType, string>> = {
  slack_dm: "SLACK_SEND_MESSAGE",
  slack_channel: "SLACK_SEND_MESSAGE",
  email: "GMAIL_SEND_EMAIL",
};

/** Toolkits that must be loaded for a target's tool to exist. */
export const DELIVER_TOOLKITS: Partial<Record<DeliverType, string>> = {
  slack_dm: "slack",
  slack_channel: "slack",
  email: "gmail",
};

/** Human-readable instruction handed to the model for each target. */
export function deliverInstruction(target: DeliverTarget): string | null {
  switch (target.type) {
    case "slack_dm":
      return `- Also send the final digest as a Slack DM to yourself using ${DELIVER_TOOL_SLUGS.slack_dm}.`;
    case "slack_channel":
      return `- Also post the final digest to Slack channel "${target.channel}" using ${DELIVER_TOOL_SLUGS.slack_channel}.`;
    case "email":
      return `- Also email the final digest to ${target.to} using ${DELIVER_TOOL_SLUGS.email}. Use the workflow name as the subject.`;
    default:
      // dashboard and webhook are delivered by the executor, not the model.
      return null;
  }
}

/** The extra toolkits a workflow's delivery targets require. */
export function deliverToolkits(deliver: DeliverTarget[]): string[] {
  return [
    ...new Set(
      deliver
        .map((d) => DELIVER_TOOLKITS[d.type])
        .filter((tk): tk is string => Boolean(tk)),
    ),
  ];
}

/**
 * Builds the final allowed-slug predicate for one run: read tools from the
 * workflow's toolkits, plus exactly the write tools its declared delivery
 * targets need — nothing else, regardless of what the toolkit exposes.
 *
 * `allowTools` (when non-empty) narrows further to an explicit whitelist, and
 * `denyTools` removes slugs outright. Both accept a trailing `*` wildcard.
 * Narrowing matters beyond safety: a toolkit can expose hundreds of tools,
 * and every schema loaded is prompt tokens spent on every step.
 *
 * `readOnly: false` drops only the read/write gate — a workflow the owner has
 * explicitly opted out of read-only may call any tool its toolkits expose,
 * still subject to the allow and deny lists.
 */
export function buildToolFilter(
  deliver: DeliverTarget[],
  allowTools: string[] = [],
  denyTools: string[] = [],
  readOnly = true,
) {
  const allowedWriteSlugs = new Set(
    deliver
      .map((d) => DELIVER_TOOL_SLUGS[d.type])
      .filter((slug): slug is string => Boolean(slug)),
  );

  return (slug: string) => {
    if (denyTools.some((p) => matchesPattern(slug, p))) return false;
    if (
      allowTools.length > 0 &&
      !allowTools.some((p) => matchesPattern(slug, p))
    )
      return false;
    if (!readOnly) return true;
    return isReadOnlyToolSlug(slug) || allowedWriteSlugs.has(slug);
  };
}

/** Case-insensitive exact match, or prefix match when the pattern ends in `*`. */
function matchesPattern(slug: string, pattern: string): boolean {
  const s = slug.toUpperCase();
  const p = pattern.trim().toUpperCase();
  if (!p) return false;
  return p.endsWith("*") ? s.startsWith(p.slice(0, -1)) : s === p;
}
