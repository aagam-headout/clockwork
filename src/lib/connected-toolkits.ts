import { listConnectedAccounts, getToolkitCatalog } from "@/lib/composio";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import type { ToolkitOption } from "@/components/workflow-form";

/**
 * The toolkits a workflow can actually use: whatever is connected in Composio
 * right now, decorated with catalog names/logos. Returns an empty list rather
 * than throwing — a Composio outage shouldn't take the form down, it should
 * just leave web search as the only option.
 */
export async function getConnectedToolkitOptions(): Promise<ToolkitOption[]> {
  const [accounts, catalog] = await Promise.allSettled([
    listConnectedAccounts(),
    getToolkitCatalog(),
  ]);

  if (accounts.status !== "fulfilled") return [];

  const meta = new Map(
    catalog.status === "fulfilled" ? catalog.value.map((t) => [t.slug, t]) : [],
  );

  const bySlug = new Map<string, ToolkitOption>();
  for (const acc of accounts.value) {
    const slug = acc.toolkit?.slug;
    if (!slug || acc.status !== "ACTIVE" || bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      name: meta.get(slug)?.name ?? TOOLKIT_LABELS[slug] ?? slug,
      logo: meta.get(slug)?.logo,
    });
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}
