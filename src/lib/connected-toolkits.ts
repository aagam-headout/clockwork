import { getToolkitCatalog } from "@/lib/composio";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import {
  getUserConnections,
  type ConnectionStatus,
} from "@/lib/data/connections";
import type { ToolkitOption } from "@/components/workflow-form";

/**
 * The toolkits a user's workflows can draw on, with the state of each.
 *
 * Two changes from the version this replaces, both load-bearing:
 *
 *  1. It reads connection state from Postgres, not from Composio. Every page
 *     that showed a toolkit picker was making a Composio API call on each
 *     render, and swallowing failures into an empty list — so a Composio blip
 *     silently told the user they had nothing connected.
 *
 *  2. It no longer drops everything that isn't ACTIVE. An expired Slack used
 *     to vanish from the builder with no explanation, taking its workflows'
 *     toolkit selections with it. Now it comes back flagged, and the form
 *     renders it as "needs reconnect" instead of pretending it was never
 *     there.
 *
 * The catalog lookup is still best-effort — it only supplies display names and
 * logos, and `TOOLKIT_LABELS` covers the common ones.
 */
export async function getConnectedToolkitOptions(
  userId: string,
): Promise<ToolkitOption[]> {
  const [connections, catalog] = await Promise.all([
    getUserConnections(userId),
    getToolkitCatalog().catch(() => []),
  ]);

  const meta = new Map(catalog.map((t) => [t.slug, t]));

  return connections
    .filter((c) => c.status !== "disconnected")
    .map((c) => ({
      slug: c.toolkit,
      name: meta.get(c.toolkit)?.name ?? TOOLKIT_LABELS[c.toolkit] ?? c.toolkit,
      logo: meta.get(c.toolkit)?.logo,
      status: c.status as ConnectionStatus,
      usable: c.usable,
    }))
    .sort(
      (a, b) =>
        // Usable first — a broken connection is still selectable, but it
        // shouldn't be what the eye lands on.
        Number(b.usable) - Number(a.usable) || a.name.localeCompare(b.name),
    );
}
