import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

// Single-user personal tool: one Composio account, one logical "user".
// Every connected account, run, and tool call in this app is scoped to
// this fixed id — there is no multi-tenant user system to plumb through.
export const COMPOSIO_USER_ID = "aagam";

export const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new VercelProvider(),
});

export { TOOLKITS, type Toolkit } from "@/lib/toolkits";

/**
 * Finds an existing Composio-managed auth config for a toolkit, or creates
 * one. `link()` (not the deprecated `initiate()`) is used for the actual
 * OAuth redirect — see https://docs.composio.dev/docs/changelog/2026/04/24.
 */
async function getOrCreateAuthConfigId(toolkit: string): Promise<string> {
  const existing = await composio.authConfigs.list({ toolkit });
  if (existing.items[0]?.id) return existing.items[0].id;

  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
    name: `${toolkit} (my-workflows)`,
  });
  return created.id;
}

/**
 * Starts a connection for `toolkit` and returns the URL to redirect the
 * browser to. Composio redirects back to `callbackUrl` once the user
 * finishes OAuth on their hosted page.
 */
export async function initiateConnection(toolkit: string, callbackUrl: string) {
  const authConfigId = await getOrCreateAuthConfigId(toolkit);
  const connectionRequest = await composio.connectedAccounts.link(
    COMPOSIO_USER_ID,
    authConfigId,
    { callbackUrl, allowMultiple: true }
  );
  return {
    connectedAccountId: connectionRequest.id,
    redirectUrl: connectionRequest.redirectUrl,
  };
}

export async function listConnectedAccounts() {
  const res = await composio.connectedAccounts.list({ userIds: [COMPOSIO_USER_ID] });
  return res.items;
}

export async function disconnectAccount(connectedAccountId: string) {
  await composio.connectedAccounts.delete(connectedAccountId);
}

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
 * catalog (~hundreds of entries) is paged in once and filtered in memory.
 * It changes rarely, so it's memoized for an hour per server instance —
 * without this, every keystroke in the connector search would re-page it.
 */
type ToolkitListPage = {
  items?: Array<{
    slug: string;
    name: string;
    noAuth?: boolean;
    meta?: {
      description?: string;
      logo?: string;
      toolsCount?: number;
      categories?: Array<{ slug: string; name: string }>;
    };
  }>;
  nextCursor?: string | null;
};

const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache: { at: number; items: ToolkitSummary[] } | null = null;

export async function getToolkitCatalog(): Promise<ToolkitSummary[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.items;
  }

  const items: ToolkitSummary[] = [];
  let cursor: string | undefined;

  // Bounded loop: the catalog is finite, but never trust a cursor to end.
  for (let page = 0; page < 20; page++) {
    // `toolkits.get` is overloaded (slug → one toolkit, query → a page); the
    // list shape is asserted here because TS resolves to the slug overload.
    const res = (await composio.toolkits.get({
      limit: 100,
      cursor,
      sortBy: "usage",
    })) as unknown as ToolkitListPage;

    for (const item of res.items ?? []) {
      items.push({
        slug: item.slug,
        name: item.name,
        description: item.meta?.description,
        logo: item.meta?.logo,
        categories: (item.meta?.categories ?? []).map((c) => c.name),
        toolsCount: item.meta?.toolsCount,
        noAuth: Boolean(item.noAuth),
      });
    }
    const next = res.nextCursor;
    if (!next) break;
    cursor = next;
  }

  catalogCache = { at: Date.now(), items };
  return items;
}

/** Case-insensitive match on slug, name, and description. */
export async function searchToolkits(query: string, limit = 24): Promise<ToolkitSummary[]> {
  const catalog = await getToolkitCatalog();
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, limit);

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

  return scored.slice(0, limit).map((r) => r.toolkit);
}

export async function toolkitExists(slug: string): Promise<boolean> {
  try {
    await composio.toolkits.get(slug);
    return true;
  } catch {
    return false;
  }
}
