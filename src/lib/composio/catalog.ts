import { composio } from "./client";

/** A toolkit as the UI needs it — flattened out of Composio's nested meta. */
export type ToolkitSummary = {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories: string[];
  toolsCount?: number;
  noAuth: boolean;
};

/*
 * Composio's toolkit list endpoint has no search parameter, so the whole
 * catalog is filtered in memory. It changes rarely, so it's memoized for an
 * hour per server instance — without this, every keystroke in the connector
 * search would re-fetch it.
 *
 * Shared across all users on purpose: this is app-wide toolkit metadata —
 * names, logos, whether a toolkit needs auth at all — and contains nothing
 * about who has connected what. That per-user question is answered from
 * Postgres (`src/lib/data/connections.ts`), which is also why connecting or
 * disconnecting an account does *not* need to invalidate this.
 *
 * `toolkits.get(query)` (the SDK's list overload) returns the matched
 * toolkits as a plain array capped at `limit` — there is no `{items,
 * nextCursor}` wrapper and no cursor in the response to page through, so a
 * single request with the server's max limit is the only way to get the
 * full catalog (server caps `limit` at 1000, which comfortably covers it).
 */
type ToolkitListItem = {
  slug: string;
  name: string;
  noAuth?: boolean;
  meta?: {
    description?: string;
    logo?: string;
    toolsCount?: number;
    categories?: Array<{ slug: string; name: string }>;
  };
};

const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache: { at: number; items: ToolkitSummary[] } | null = null;

/** Escape hatch for an admin/debug path; nothing in normal operation needs it. */
export function invalidateToolkitCatalog() {
  catalogCache = null;
}

export async function getToolkitCatalog(): Promise<ToolkitSummary[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.items;
  }

  // `toolkits.get` is overloaded (slug → one toolkit, query → a list); the
  // list shape is asserted here because TS resolves to the slug overload.
  const res = (await composio.toolkits.get({
    limit: 1000,
    sortBy: "usage",
  })) as unknown as ToolkitListItem[];

  const items: ToolkitSummary[] = res.map((item) => ({
    slug: item.slug,
    name: item.name,
    description: item.meta?.description,
    logo: item.meta?.logo,
    categories: (item.meta?.categories ?? []).map((c) => c.name),
    toolsCount: item.meta?.toolsCount,
    noAuth: Boolean(item.noAuth),
  }));

  catalogCache = { at: Date.now(), items };
  return items;
}

/**
 * Case-insensitive match on slug, name, and description, paged with
 * `offset`/`limit` — the full catalog can run past a thousand toolkits, and
 * without paging the browser could only ever reach whichever `limit` came
 * first.
 */
export async function searchToolkits(
  query: string,
  limit = 24,
  offset = 0,
): Promise<ToolkitSummary[]> {
  const catalog = await getToolkitCatalog();
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(offset, offset + limit);

  const scored = catalog
    .map((toolkit) => {
      const slug = toolkit.slug.toLowerCase();
      const name = toolkit.name.toLowerCase();
      let score = -1;
      if (slug === q || name === q) score = 0;
      else if (name.startsWith(q) || slug.startsWith(q)) score = 1;
      else if (name.includes(q) || slug.includes(q)) score = 2;
      else if (toolkit.description?.toLowerCase().includes(q)) score = 3;
      return { toolkit, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score);

  return scored.slice(offset, offset + limit).map((r) => r.toolkit);
}

/**
 * True for toolkits Composio serves without a connected account (its own
 * `composio` toolkit, most public APIs). Creating an auth config for one is a
 * hard 400 — `Auth_Config_NoAuthApp` — so the connect flow has to check first.
 */
export async function toolkitIsNoAuth(slug: string): Promise<boolean> {
  const catalog = await getToolkitCatalog();
  return Boolean(catalog.find((t) => t.slug === slug)?.noAuth);
}

/**
 * Slugs that never need a connected account.
 *
 * Falls back to the one toolkit we know is no-auth rather than to an empty
 * set: if the catalog can't be reached, treating every toolkit as requiring a
 * connection would block runs that were previously fine, and treating none as
 * requiring one would skip the preflight entirely. `composio_search` is the
 * built-in web search every workflow can use, and it is always no-auth.
 */
export async function noAuthToolkitSlugs(): Promise<Set<string>> {
  try {
    const catalog = await getToolkitCatalog();
    const slugs = catalog.filter((t) => t.noAuth).map((t) => t.slug);
    return new Set([...slugs, "composio_search"]);
  } catch {
    return new Set(["composio_search"]);
  }
}

export async function toolkitExists(slug: string): Promise<boolean> {
  try {
    await composio.toolkits.get(slug);
    return true;
  } catch {
    return false;
  }
}
