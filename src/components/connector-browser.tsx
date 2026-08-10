"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  LoaderCircle,
  Plus,
  Check,
  TriangleAlert,
  X,
  Wrench,
} from "lucide-react";
import { buttonClass, Badge, Skeleton } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";
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
  header,
}: {
  connectedSlugs: string[];
  initialItems: ToolkitSummary[];
  /**
   * The section heading. It's rendered here rather than by the page so it can
   * live inside the same sticky block as the search field and the filter chips
   * — the catalog grid is long, and the controls that drive it shouldn't scroll
   * away from it.
   */
  header?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ToolkitSummary[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await fetchJson<{ items?: ToolkitSummary[] }>(
            `/api/toolkits?q=${encodeURIComponent(query)}`,
          );
          // Ignore responses that a newer keystroke has already superseded.
          if (id === requestId.current) {
            // A 200 with a malformed body would otherwise put `undefined` in
            // state, and the grid maps over it on the next render.
            setItems(Array.isArray(data.items) ? data.items : []);
            // A category picked from the old result set may not exist in the
            // new one, which would render an empty grid with no explanation.
            setCategory(null);
          }
        } catch (err) {
          if (id === requestId.current) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      },
      query ? 220 : 0,
    );

    return () => clearTimeout(timer);
  }, [query]);

  // "/" focuses the field from anywhere on the page, as long as the user isn't
  // already typing somewhere else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")
      )
        return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const connected = new Set(connectedSlugs);

  // Facets are derived from the result set rather than the full catalog, so a
  // chip never promises rows the current search can't show.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const c of item.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);
  }, [items]);

  const visible = category
    ? items.filter((t) => t.categories.includes(category))
    : items;

  const firstLoad = loading && items.length === 0;

  return (
    <div>
      {/*
       * Sticks once it reaches the top of the viewport. The negative inset plus
       * matching padding lets the background bleed past the content column, so
       * cards passing underneath don't show at the edges; below `md` it parks
       * under the 56px mobile top bar instead of behind it.
       */}
      <div className="bg-bg/95 sticky top-14 z-20 -mx-2 -mt-4 px-2 pt-4 pb-3 backdrop-blur-md md:top-0">
        {header}

        <div className="relative">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search the catalog — gmail, slack, notion…"
            className="input h-10 pr-10 pl-9"
            aria-label="Search connectors"
          />
          {loading ? (
            <LoaderCircle className="text-subtle absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
          ) : (
            query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="text-subtle hover:text-foreground rounded-control absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )
          )}
        </div>

        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={category === null}
              onClick={() => setCategory(null)}
            >
              All
            </FilterChip>
            {categories.map(([name, count]) => (
              <FilterChip
                key={name}
                active={category === name}
                onClick={() => setCategory(category === name ? null : name)}
              >
                {name}
                <span className="tabular-nums opacity-55">{count}</span>
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-control border-danger-line bg-danger-soft text-danger-text mt-3 flex items-center gap-1.5 border px-3 py-2 text-[13px]">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {!error && !loading && visible.length === 0 && (
        <p className="rounded-container border-border bg-bg-subtle text-muted mt-4 border px-4 py-10 text-center text-sm">
          No connector matches {query ? `“${query}”` : "this filter"}.
        </p>
      )}

      {firstLoad ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-container border-border bg-surface border p-3.5"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="rounded-control h-9 w-9" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
              <Skeleton className="mt-3 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div
          className={`mt-4 grid grid-cols-1 gap-3 transition-opacity duration-150 sm:grid-cols-2 xl:grid-cols-3 ${
            loading ? "opacity-55" : ""
          }`}
        >
          {visible.map((toolkit) => {
            const isConnected = connected.has(toolkit.slug);
            return (
              <div
                key={toolkit.slug}
                className={`rounded-container flex flex-col gap-3 border p-3.5 transition-[border-color,background] duration-150 ${
                  isConnected
                    ? "border-success-line bg-success-soft/35"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <div className="flex items-start gap-3">
                  <ToolkitLogo
                    slug={toolkit.slug}
                    name={toolkit.name}
                    logo={toolkit.logo}
                    size="lg"
                    connected={isConnected}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="heading-14 text-foreground truncate">
                      {toolkit.name}
                    </div>
                    <p className="text-subtle mt-0.5 line-clamp-2 text-[11px] leading-4">
                      {toolkit.description ?? toolkit.slug}
                    </p>
                  </div>
                </div>

                <div className="border-border/70 flex items-center gap-1.5 border-t pt-2.5">
                  {toolkit.toolsCount != null && (
                    <span className="text-subtle inline-flex items-center gap-1 text-[11px] tabular-nums">
                      <Wrench className="h-3 w-3" />
                      {toolkit.toolsCount}
                    </span>
                  )}
                  {toolkit.noAuth && <Badge tone="neutral">no auth</Badge>}
                  <div className="flex-1" />
                  {isConnected ? (
                    <span className="text-success-text inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                      <Check className="h-4 w-4" />
                      Linked
                    </span>
                  ) : toolkit.noAuth ? (
                    /* Composio rejects an auth config for these outright
                       ("does not require authentication"), so offering Connect
                       only produced a 400. Their tools are already usable. */
                    <span className="text-subtle shrink-0 text-xs">
                      Ready to use
                    </span>
                  ) : (
                    <a
                      href={`/api/connections/${toolkit.slug}/connect`}
                      aria-label={`Connect ${toolkit.name}`}
                      className={buttonClass("outline", "sm")}
                    >
                      <Plus className="h-4 w-4" />
                      Connect
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-chip inline-flex h-7 cursor-pointer items-center gap-1.5 border px-2.5 text-[11px] font-medium capitalize transition-[background,border-color,color] duration-150 ${
        active
          ? // `border-solid` is Tailwind's border-*style* utility, so the
            // inverted chip names the token directly.
            "bg-solid text-solid-fg border-[var(--solid)]"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
