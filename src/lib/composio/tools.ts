import type { ToolSet } from "ai";
import { composio } from "./client";
import { composioUserId } from "./identity";

/*
 * Tool schemas, cached across users.
 *
 * `tools.get(userId, query)` is two things: an HTTP fetch of the tool schemas
 * for a toolkit set, and a local wrap that binds each tool's `execute` to a
 * Composio user id. Only the second half is user-specific — the fetch
 * (`getRawComposioTools`) takes no user id at all — so the schemas can safely
 * be shared, and the fetch is what costs a round trip on every single run and
 * every builder research turn.
 *
 * Two invariants this must keep:
 *
 *  1. Only the *raw* schemas are cached. The wrapped ToolSet closes over a
 *     user id, so a cross-user cache hit on that would execute one user's tool
 *     call against another user's credentials. `wrapToolsForProvider` is cheap
 *     and synchronous, so re-running it per call costs nothing worth saving.
 *  2. Bounded. Tool schema sets run to hundreds of kilobytes; the LRU cap is
 *     what keeps a long-lived instance from accumulating every toolkit
 *     combination any user has ever asked for.
 */
type Tool = Awaited<
  ReturnType<typeof composio.tools.getRawComposioTools>
>[number];

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 24;

const cache = new Map<string, { at: number; tools: Tool[] }>();

function cacheKey(toolkits: string[]): string {
  return [...toolkits]
    .map((t) => t.toLowerCase())
    .sort()
    .join(",");
}

function readCache(key: string): Tool[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency: Map preserves insertion order, so re-inserting moves this
  // key to the end and makes the first key the least recently used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.tools;
}

function writeCache(key: string, tools: Tool[]) {
  cache.set(key, { at: Date.now(), tools });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearToolCache() {
  cache.clear();
}

/**
 * The AI SDK tool set for one user over one set of toolkits.
 *
 * Equivalent to `composio.tools.get(composioUserId(userId), { toolkits })`,
 * minus the repeated schema fetch.
 */
export async function getToolsFor(
  userId: string,
  toolkits: string[],
): Promise<ToolSet> {
  const key = cacheKey(toolkits);

  let tools = readCache(key);
  if (!tools) {
    tools = await composio.tools.getRawComposioTools({ toolkits });
    writeCache(key, tools);
  }

  return composio.tools.wrapToolsForProvider(
    composioUserId(userId),
    tools,
  ) as unknown as ToolSet;
}
