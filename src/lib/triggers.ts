import { composio, COMPOSIO_USER_ID } from "@/lib/composio";

/**
 * Event triggers: the other half of the schedule. Cron answers "every
 * weekday at 8", Composio triggers answer "whenever this actually happens" —
 * a new email, an issue assigned to you, a Slack mention — which is what a
 * five-minute polling tick can only approximate.
 *
 * Composio delivers them as one project-wide webhook; the ingress route
 * (`/api/triggers/composio`) fans a single event out to every workflow that
 * subscribed to that trigger slug.
 */

export type TriggerTypeOption = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
};

const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache: {
  at: number;
  key: string;
  items: TriggerTypeOption[];
} | null = null;

/** Trigger types available for the given toolkits (all of them if empty). */
export async function listTriggerTypes(
  toolkits: string[] = [],
): Promise<TriggerTypeOption[]> {
  const key = [...toolkits].sort().join(",");
  if (
    catalogCache &&
    catalogCache.key === key &&
    Date.now() - catalogCache.at < CATALOG_TTL_MS
  ) {
    return catalogCache.items;
  }

  const res = await composio.triggers.listTypes(
    toolkits.length > 0 ? { toolkits, limit: 100 } : { limit: 100 },
  );

  const items = (res.items ?? [])
    // Composio has shipped entries with a null toolkit; `t.toolkit.slug` threw
    // on those and lost the whole catalog to one bad row.
    .filter((t) => t?.slug)
    .map((t) => ({
      slug: t.slug,
      name: t.name || t.slug,
      description: t.description ?? "",
      toolkit: t.toolkit?.slug ?? "",
    }));

  catalogCache = { at: Date.now(), key, items };
  return items;
}
/*
 * Note: this deliberately does not swallow Composio failures. It used to
 * return `[]` on any error, which made "Composio is down" and "these toolkits
 * have no triggers" the same empty list — the caller (`/api/trigger-types`)
 * turns the throw into a 502 with a reason the picker can show.
 */

/**
 * Points Composio's project webhook at this deployment. Idempotent — the SDK
 * updates the existing subscription rather than stacking new ones.
 */
export async function ensureWebhookSubscription(): Promise<void> {
  const base = process.env.APP_URL;
  if (!base) throw new Error("APP_URL is not set — cannot register a webhook");

  await composio.triggers.setWebhookSubscription({
    webhookUrl: `${base.replace(/\/$/, "")}/api/triggers/composio`,
  });
}

export type TriggerSyncResult = { slug: string; ok: boolean; error?: string };

/**
 * Makes sure a trigger instance exists for every slug a workflow listens to.
 * Best-effort per slug: one trigger that needs config the form didn't collect
 * shouldn't stop the others from being registered.
 */
export async function syncEventTriggers(
  slugs: string[],
): Promise<TriggerSyncResult[]> {
  if (slugs.length === 0) return [];

  await ensureWebhookSubscription();

  let active: Set<string>;
  try {
    const listed = await composio.triggers.listActive();
    active = new Set(
      (listed.items ?? [])
        .filter((i) => !i.disabledAt)
        .map((i) => i.triggerName.toUpperCase()),
    );
  } catch {
    active = new Set();
  }

  const results: TriggerSyncResult[] = [];
  for (const slug of slugs) {
    if (active.has(slug.toUpperCase())) {
      results.push({ slug, ok: true });
      continue;
    }
    try {
      await composio.triggers.create(COMPOSIO_USER_ID, slug);
      results.push({ slug, ok: true });
    } catch (err) {
      results.push({
        slug,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
