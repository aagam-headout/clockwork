"use client";

import { useEffect, useRef, useState } from "react";
import { Search, LoaderCircle, Plus, Check, TriangleAlert } from "lucide-react";
import { buttonClass, Badge } from "@/components/ui";
import { ToolkitLogo } from "@/components/toolkit-logo";

export type ToolkitSummary = {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories: string[];
  toolsCount?: number;
  noAuth: boolean;
};

/**
 * Search across the whole Composio catalog and connect anything in it — the
 * app is not limited to a curated toolkit list. `connectedSlugs` is used only
 * to mark rows that are already linked.
 */
export function ConnectorBrowser({
  connectedSlugs,
  initialItems,
}: {
  connectedSlugs: string[];
  initialItems: ToolkitSummary[];
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ToolkitSummary[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`/api/toolkits?q=${encodeURIComponent(query)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Search failed");
          // Ignore responses that a newer keystroke has already superseded.
          if (id === requestId.current) setItems(data.items);
        } catch (err) {
          if (id === requestId.current) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      },
      query ? 220 : 0
    );

    return () => clearTimeout(timer);
  }, [query]);

  const connected = new Set(connectedSlugs);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors…"
          className="input h-10 pl-9 pr-9"
          aria-label="Search connectors"
        />
        {loading && (
          <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-subtle" />
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {!error && items.length === 0 && !loading && (
        <p className="mt-4 rounded-container border border-border bg-bg-subtle px-4 py-10 text-center text-sm text-muted">
          No connector matches “{query}”.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((toolkit) => {
          const isConnected = connected.has(toolkit.slug);
          return (
            <div
              key={toolkit.slug}
              className="flex items-center gap-3 rounded-container border border-border bg-surface p-3 transition-colors hover:border-border-strong"
            >
              <ToolkitLogo slug={toolkit.slug} name={toolkit.name} logo={toolkit.logo} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {toolkit.name}
                  </span>
                  {toolkit.noAuth && <Badge tone="neutral">no auth</Badge>}
                </div>
                <p className="truncate text-[11px] text-subtle">
                  {toolkit.description ?? toolkit.slug}
                </p>
              </div>

              {isConnected ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success-text">
                  <Check className="h-3.5 w-3.5" />
                  Linked
                </span>
              ) : (
                <a
                  href={`/api/connections/${toolkit.slug}/connect`}
                  className={buttonClass("outline", "sm")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Connect
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
