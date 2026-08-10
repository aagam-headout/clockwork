/**
 * Read-only enforcement gate. This runs server-side, before any tool
 * schema reaches the model — the agent never even sees a write tool it
 * wasn't explicitly granted via a workflow's `deliver` targets.
 */

// Read-verb tool slugs, e.g. GITHUB_LIST_REPOS, GMAIL_FETCH_EMAILS,
// SLACK_LIST_CHANNELS. Composio slugs are SCREAMING_SNAKE, verb usually
// appears as its own segment.
const READ_VERB = /(^|_)(GET|LIST|SEARCH|FETCH|READ|RETRIEVE|FIND|QUERY)(_|$)/;

// Composio's built-in search toolkit needs no auth and is read-only by
// construction — always allow it regardless of a workflow's toolkit list.
const ALWAYS_ALLOWED_PREFIXES = ["COMPOSIO_SEARCH_"];

export function isReadOnlyToolSlug(slug: string): boolean {
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => slug.startsWith(p))) return true;
  return READ_VERB.test(slug);
}

/**
 * Delivery targets a workflow can declare. Each maps to the one write tool
 * slug it's allowed to use, plus the argument shape the executor pins so
 * the model can't redirect output anywhere else.
 */
export type DeliverTarget =
  | { type: "dashboard" } // no tool call — executor persists the output row
  | { type: "slack_dm" }; // SLACK_SEND_MESSAGE, channel pinned to your own user id

export const DELIVER_TOOL_SLUGS: Record<string, string> = {
  slack_dm: "SLACK_SEND_MESSAGE",
};

/**
 * Builds the final allowed-slug predicate for one run: read tools from the
 * workflow's toolkits, plus exactly the write tools its declared delivery
 * targets need — nothing else, regardless of what the toolkit exposes.
 */
export function buildToolFilter(deliver: DeliverTarget[]) {
  const allowedWriteSlugs = new Set(
    deliver
      .map((d) => DELIVER_TOOL_SLUGS[d.type])
      .filter((slug): slug is string => Boolean(slug)),
  );

  return (slug: string) =>
    isReadOnlyToolSlug(slug) || allowedWriteSlugs.has(slug);
}
