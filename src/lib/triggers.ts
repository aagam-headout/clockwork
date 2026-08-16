import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { triggerInstances, workflows } from "@/db/schema";
import { composio, composioUserId, composioErrorMessage } from "@/lib/composio";
import { activeToolkitSlugs, getUserConnection } from "@/lib/data/connections";
import { resolveBaseUrl } from "@/lib/base-url";

/**
 * Event triggers: the other half of the schedule. Cron answers "every
 * weekday at 8"; Composio triggers answer "whenever this actually happens"
 * — a new email, an issue assigned to you, a Slack mention — which a
 * five-minute polling tick can only approximate.
 *
 * Composio delivers them as one project-wide webhook; the ingress route
 * (`/api/triggers/composio`) resolves the event's owner and fans it out to
 * their subscribed workflows.
 */

export type TriggerTypeOption = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
};

const CATALOG_TTL_MS = 60 * 60 * 1000;
const MAX_CATALOG_ENTRIES = 50;

/*
 * Keyed by toolkit set. This was a single-entry cache — toggling a toolkit
 * in the workflow form evicted the previous answer every time, so the hit
 * rate sat at roughly zero. Trigger *types* are catalog data, same for every
 * user, so one shared map is right.
 */
const catalogCache = new Map<
  string,
  { at: number; items: TriggerTypeOption[] }
>();

/** Trigger types available for the given toolkits (all of them if empty). */
export async function listTriggerTypes(
  toolkits: string[] = [],
): Promise<TriggerTypeOption[]> {
  const key = [...toolkits].sort().join(",");

  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.items;

  const res = await composio.triggers.listTypes(
    toolkits.length > 0 ? { toolkits, limit: 100 } : { limit: 100 },
  );

  const items = (res.items ?? [])
    // Composio has shipped entries with a null toolkit; `t.toolkit.slug` threw
    // on those, losing the whole catalog to one bad row.
    .filter((t) => t?.slug)
    .map((t) => ({
      slug: t.slug,
      name: t.name || t.slug,
      description: t.description ?? "",
      toolkit: t.toolkit?.slug ?? "",
    }));

  catalogCache.set(key, { at: Date.now(), items });
  while (catalogCache.size > MAX_CATALOG_ENTRIES) {
    const oldest = catalogCache.keys().next().value;
    if (oldest === undefined) break;
    catalogCache.delete(oldest);
  }
  return items;
}
/*
 * Note: deliberately doesn't swallow Composio failures. It used to return
 * `[]` on any error, making "Composio is down" and "these toolkits have no
 * triggers" the same empty list — the caller (`/api/trigger-types`) turns
 * the throw into a 502 with a reason the picker can show.
 */

/** Which toolkit a trigger slug belongs to, from the cached type catalog. */
async function toolkitForTriggerSlug(slug: string): Promise<string | null> {
  try {
    const types = await listTriggerTypes();
    return types.find((t) => t.slug === slug)?.toolkit || null;
  } catch {
    return null;
  }
}

/**
 * Points Composio's project webhook at this deployment. Idempotent — the SDK
 * updates the existing subscription rather than stacking new ones.
 */
export async function ensureWebhookSubscription(): Promise<void> {
  const base = resolveBaseUrl(process.env.APP_URL);
  if (!base) throw new Error("APP_URL is not set — cannot register a webhook");

  await composio.triggers.setWebhookSubscription({
    webhookUrl: `${base}/api/triggers/composio`,
  });
}

export type TriggerSyncResult = { slug: string; ok: boolean; error?: string };

/**
 * Reconciles one user's Composio trigger instances against what their
 * workflows subscribe to. Creates what's missing, deletes what's no longer
 * wanted.
 *
 * The delete half is the part that never existed. Without it, removing an
 * event from a workflow — or deleting the workflow outright — left the
 * trigger live at Composio, delivering events forever to a fan-out that
 * matches nothing.
 *
 * The desired set is *derived* from the user's enabled event workflows
 * rather than passed in, making the shared-slug case correct by
 * construction: two workflows listening to the same trigger, one deleted,
 * still leaves the slug in the union, so the trigger stays.
 *
 * `trigger_instances` is not a cache — it's the only record of the Composio
 * trigger ids we created. The SDK's `listActive` has no user filter and its
 * items carry no user id, so a trigger whose id we didn't persist can never
 * be found again.
 */
export async function syncEventTriggers(
  userId: string,
): Promise<TriggerSyncResult[]> {
  const current = await db
    .select()
    .from(triggerInstances)
    .where(eq(triggerInstances.userId, userId));

  const rows = await db
    .select({ slugs: workflows.eventTriggers })
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, userId),
        eq(workflows.enabled, true),
        eq(workflows.triggerType, "event"),
      ),
    );

  const desired = new Set(rows.flatMap((r) => r.slugs));

  // Nothing wanted and nothing registered: don't touch the webhook config.
  if (desired.size === 0 && current.length === 0) return [];

  await ensureWebhookSubscription();

  const results: TriggerSyncResult[] = [];
  const active = await activeToolkitSlugs(userId);
  const cid = composioUserId(userId);

  // --- create ---
  for (const slug of desired) {
    if (current.some((r) => r.triggerSlug === slug && r.composioTriggerId)) {
      results.push({ slug, ok: true });
      continue;
    }

    const toolkit = await toolkitForTriggerSlug(slug);
    if (toolkit && !active.has(toolkit)) {
      // Registering against a toolkit with no live connection is a guaranteed
      // Composio 4xx; say so instead of spending the call.
      results.push({ slug, ok: false, error: `${toolkit} is not connected` });
      continue;
    }

    const conn = toolkit ? await getUserConnection(userId, toolkit) : null;

    try {
      /*
       * Pin the connected account. Left unpinned, Composio picks "the first
       * active connection for this user and toolkit" — right after a
       * reconnect, that can be the superseded account we're about to delete.
       */
      const created = await composio.triggers.create(
        cid,
        slug,
        conn?.connectedAccountId
          ? { connectedAccountId: conn.connectedAccountId }
          : undefined,
      );

      await upsertTriggerInstance({
        userId,
        slug,
        composioTriggerId: created.triggerId,
        connectedAccountId: conn?.connectedAccountId ?? null,
        status: "active",
        error: null,
      });
      results.push({ slug, ok: true });
    } catch (err) {
      const error = composioErrorMessage(err);
      await upsertTriggerInstance({
        userId,
        slug,
        composioTriggerId: null,
        connectedAccountId: null,
        status: "failed",
        error,
      });
      results.push({ slug, ok: false, error });
    }
  }

  // --- delete ---
  for (const row of current) {
    if (desired.has(row.triggerSlug)) continue;
    try {
      if (row.composioTriggerId) {
        await composio.triggers.delete(row.composioTriggerId);
      }
      await db.delete(triggerInstances).where(eq(triggerInstances.id, row.id));
    } catch (err) {
      /*
       * Keep the row. Deleting it here on a failed Composio call would
       * permanently orphan a live trigger — this row's id is the only handle
       * we have on it. The next sync retries.
       */
      results.push({
        slug: row.triggerSlug,
        ok: false,
        error: composioErrorMessage(err),
      });
    }
  }

  return results;
}

async function upsertTriggerInstance(args: {
  userId: string;
  slug: string;
  composioTriggerId: string | null;
  connectedAccountId: string | null;
  status: string;
  error: string | null;
}) {
  const now = new Date();
  await db
    .insert(triggerInstances)
    .values({
      userId: args.userId,
      triggerSlug: args.slug,
      composioTriggerId: args.composioTriggerId,
      connectedAccountId: args.connectedAccountId,
      status: args.status,
      error: args.error,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [triggerInstances.userId, triggerInstances.triggerSlug],
      set: {
        composioTriggerId: args.composioTriggerId,
        connectedAccountId: args.connectedAccountId,
        status: args.status,
        error: args.error,
        updatedAt: now,
      },
    });
}
