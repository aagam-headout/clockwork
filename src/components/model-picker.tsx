"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  X,
  Check,
  LoaderCircle,
  Zap,
  Gauge,
  Brain,
  ChevronsUpDown,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui";
import {
  TIER_HINTS,
  TIER_LABELS,
  TYPICAL_RUN,
  costPerRun,
  formatUsd,
  runsPerDollar,
  type ModelInfo,
  type ModelTier,
} from "@/lib/model-tiers";

const TIER_ICON: Record<
  ModelTier,
  React.ComponentType<{ className?: string }>
> = {
  light: Zap,
  mid: Gauge,
  heavy: Brain,
};

type Filter = "recommended" | ModelTier | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "recommended", label: "Light + Mid" },
  { key: "light", label: "Light" },
  { key: "mid", label: "Mid" },
  { key: "heavy", label: "Heavy" },
  { key: "all", label: "All" },
];

/** Gateway slugs are lowercase; these are the ones whose casing isn't guessable. */
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  xai: "xAI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  perplexity: "Perplexity",
  bedrock: "Bedrock",
  vertex: "Vertex",
  azure: "Azure",
};

function providerLabel(slug: string): string {
  if (!slug) return "Other";
  return (
    PROVIDER_LABELS[slug] ??
    slug
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function matchesTier(tier: ModelTier, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "recommended") return tier === "light" || tier === "mid";
  return tier === filter;
}

function matchesQuery(model: ModelInfo, q: string): boolean {
  if (!q) return true;
  return (
    model.id.toLowerCase().includes(q) ||
    model.name.toLowerCase().includes(q) ||
    model.provider.toLowerCase().includes(q)
  );
}

/**
 * Model selector: a trigger button showing the current pick and its cost, and
 * a searchable modal over the full AI Gateway catalog. The value is submitted
 * through a hidden input, so the surrounding <form action> keeps working
 * exactly as it did with a native <select>.
 */
export function ModelPicker({
  name = "model",
  defaultValue,
  value,
  onChange,
  variant = "field",
  initialModels,
  include,
}: {
  /** Hidden input name for <form action> use. Pass null outside a form. */
  name?: string | null;
  defaultValue?: string;
  /** Pass with `onChange` to drive the pick from parent state instead. */
  value?: string;
  onChange?: (id: string) => void;
  /** `compact` is the header pill: one line, no cost sub-label. */
  variant?: "field" | "compact";
  initialModels: ModelInfo[];
  /**
   * Restricts the offered catalog — used by the builder's picker, where only
   * frontier models can do the job. Must be a stable reference.
   */
  include?: (model: ModelInfo) => boolean;
}) {
  const [fetched, setFetched] = useState<ModelInfo[]>(initialModels);
  // One gate for the whole component: every facet, count and row below reads
  // the narrowed list, so a restricted picker can't surface a rejected id.
  const models = useMemo(
    () => (include ? fetched.filter(include) : fetched),
    [fetched, include],
  );
  const [internalId, setInternalId] = useState(
    value ??
      defaultValue ??
      initialModels.find((m) => m.tier === "mid")?.id ??
      initialModels[0]?.id ??
      "",
  );
  const selectedId = value ?? internalId;

  function select(id: string) {
    setInternalId(id);
    onChange?.(id);
  }
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // A restricted pool is short and skews expensive; hiding heavy models
  // behind "Light + Mid" would open the dialog on a near-empty list.
  const [filter, setFilter] = useState<Filter>(include ? "all" : "recommended");
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selected =
    models.find((m) => m.id === selectedId) ??
    ({
      id: selectedId,
      name: selectedId,
      provider: "",
      tier: "mid",
    } as ModelInfo);

  // Refresh the catalog on open: the server-rendered list is a snapshot, and
  // pricing/availability changes without a redeploy. In the click handler,
  // not an effect, so opening doesn't cascade renders.
  async function openPicker() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0)
        setFetched(data.items);
    } catch {
      // Keep the server-rendered list.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim().toLowerCase();

  // Each facet counts against the *other* facets, so a count never shows a
  // number that would drop to zero the moment you click it.
  const providers = useMemo(() => {
    const byProvider = new Map<string, number>();
    for (const m of models) {
      if (!matchesTier(m.tier, filter) || !matchesQuery(m, q)) continue;
      byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + 1);
    }
    return [...byProvider.entries()]
      .map(([slug, count]) => ({ slug, count, label: providerLabel(slug) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [models, filter, q]);

  // A provider the current tier/query no longer offers falls back to "all"
  // instead of an empty list — but stays in state, so it returns when the
  // tier that had it is reselected.
  const activeProvider =
    provider != null && providers.some((p) => p.slug === provider)
      ? provider
      : null;

  const visible = useMemo(
    () =>
      models.filter(
        (m) =>
          matchesTier(m.tier, filter) &&
          (activeProvider == null || m.provider === activeProvider) &&
          matchesQuery(m, q),
      ),
    [models, q, filter, activeProvider],
  );

  const tierCounts = useMemo(() => {
    const pool = models.filter(
      (m) =>
        (activeProvider == null || m.provider === activeProvider) &&
        matchesQuery(m, q),
    );
    return {
      all: pool.length,
      light: pool.filter((m) => m.tier === "light").length,
      mid: pool.filter((m) => m.tier === "mid").length,
      heavy: pool.filter((m) => m.tier === "heavy").length,
    };
  }, [models, activeProvider, q]);

  return (
    <>
      {name != null && <input type="hidden" name={name} value={selectedId} />}

      {variant === "compact" ? (
        <button
          type="button"
          onClick={openPicker}
          title={`${selected.id} — click to change`}
          className="border-border bg-surface text-muted hover:border-border-strong hover:text-foreground rounded-control flex h-8 max-w-[200px] cursor-pointer items-center gap-1.5 border px-3 text-xs font-medium transition-colors"
        >
          <span className="truncate">{selected.name}</span>
          <ChevronsUpDown className="text-subtle h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          className="rounded-control border-border bg-bg hover:border-border-strong flex w-full cursor-pointer items-center gap-2 border px-2.5 py-2 text-left transition-colors"
        >
          <TierGlyph tier={selected.tier} />
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-[13px] font-medium">
              {selected.name}
            </span>
            <span className="text-subtle block truncate font-mono text-[10.5px]">
              {selected.blendedPerM != null
                ? `${formatUsd(selected.blendedPerM)}/1M · ≈${formatUsd(costPerRun(selected))} per run`
                : selected.id}
            </span>
          </span>
          <ChevronsUpDown className="text-subtle h-3.5 w-3.5 shrink-0" />
        </button>
      )}

      {/*
       * Portalled to <body>: the form wrapper is a `@container`, and
       * container-type makes it the containing block for fixed children — so
       * the overlay would otherwise centre inside the form column, not the
       * viewport.
       */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
            <button
              type="button"
              aria-label="Close model picker"
              onClick={() => setOpen(false)}
              className="bg-bg/60 absolute inset-0 backdrop-blur-[2px]"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Choose a model"
              className="rise rounded-container border-border bg-surface shadow-pop relative flex max-h-[76vh] w-full max-w-3xl flex-col overflow-hidden border"
            >
              <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-4">
                <Search className="text-subtle h-4 w-4 shrink-0" />
                {/* The dialog itself is the focus surface — a ring around the
                  bare search field would box in the whole header. */}
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="text-foreground placeholder:text-subtle min-w-0 flex-1 border-0 bg-transparent text-sm shadow-none outline-none focus:outline-none focus-visible:outline-none"
                />
                {loading && (
                  <LoaderCircle className="text-subtle h-4 w-4 shrink-0 animate-spin" />
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-control border-border text-muted hover:border-border-strong hover:bg-surface-hover hover:text-foreground flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Same px-4 gutter as the search row and the result rows, so the
                  dialog reads as one column top to bottom. */}
              <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
                {FILTERS.map((f) => {
                  const active = filter === f.key;
                  const count =
                    f.key === "all"
                      ? tierCounts.all
                      : f.key === "recommended"
                        ? tierCounts.light + tierCounts.mid
                        : tierCounts[f.key];
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      title={
                        f.key in TIER_HINTS
                          ? TIER_HINTS[f.key as ModelTier]
                          : undefined
                      }
                      className={`rounded-control h-8 cursor-pointer border px-3.5 text-xs font-medium transition-colors ${
                        active
                          ? "border-border-strong bg-surface-2 text-foreground"
                          : "border-border text-muted hover:border-border-strong hover:text-foreground"
                      }`}
                    >
                      {f.label}
                      <span className="ml-1 tabular-nums opacity-60">
                        {count}
                      </span>
                    </button>
                  );
                })}

                {/* The provider rail is hidden on narrow screens — same filter, native control. */}
                <select
                  aria-label="Filter by provider"
                  value={activeProvider ?? ""}
                  onChange={(e) => setProvider(e.target.value || null)}
                  className="border-border bg-surface text-muted rounded-control h-8 cursor-pointer border px-2.5 text-xs font-medium sm:hidden"
                >
                  <option value="">All providers ({tierCounts.all})</option>
                  {providers.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.label} ({p.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex min-h-0 flex-1">
                <nav
                  aria-label="Filter by provider"
                  className="border-border bg-bg-subtle hidden w-44 shrink-0 overflow-y-auto border-r p-2 sm:block"
                >
                  <ProviderRow
                    label="All providers"
                    count={tierCounts.all}
                    active={activeProvider == null}
                    onClick={() => setProvider(null)}
                    icon={<Layers className="h-3.5 w-3.5" />}
                  />
                  {providers.map((p) => (
                    <ProviderRow
                      key={p.slug}
                      label={p.label}
                      count={p.count}
                      active={activeProvider === p.slug}
                      onClick={() => setProvider(p.slug)}
                    />
                  ))}
                </nav>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {visible.length === 0 ? (
                    <p className="text-muted px-4 py-12 text-center text-sm">
                      {query
                        ? `No model matches “${query}”.`
                        : "No model matches these filters."}
                    </p>
                  ) : (
                    <ul>
                      {visible.map((model) => {
                        const isSelected = model.id === selectedId;
                        const perRun = costPerRun(model);
                        const efficiency = runsPerDollar(model);
                        return (
                          <li key={model.id}>
                            <button
                              type="button"
                              onClick={() => {
                                select(model.id);
                                setOpen(false);
                              }}
                              className={`border-border flex w-full cursor-pointer items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 ${
                                isSelected
                                  ? "bg-surface-2"
                                  : "hover:bg-surface-hover"
                              }`}
                            >
                              <TierGlyph tier={model.tier} />

                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-foreground truncate text-[13px] font-medium">
                                    {model.name}
                                  </span>
                                  <Badge tone="neutral">
                                    {TIER_LABELS[model.tier]}
                                  </Badge>
                                  {isSelected && (
                                    <Check className="text-foreground h-3.5 w-3.5" />
                                  )}
                                </span>
                                <span className="text-subtle mt-0.5 block truncate font-mono text-[10.5px]">
                                  {model.id}
                                </span>

                                <span className="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
                                  <span>
                                    in {formatUsd(model.inputPerM)}/1M
                                  </span>
                                  <span>
                                    out {formatUsd(model.outputPerM)}/1M
                                  </span>
                                  {model.cachedInputPerM != null && (
                                    <span>
                                      cached {formatUsd(model.cachedInputPerM)}
                                      /1M
                                    </span>
                                  )}
                                </span>
                              </span>

                              <span className="shrink-0 text-right">
                                <span className="text-foreground block text-[12px] font-semibold tabular-nums">
                                  {formatUsd(perRun)}
                                </span>
                                <span className="text-subtle block text-[10px]">
                                  per run
                                </span>
                                {efficiency != null && (
                                  <span className="text-subtle mt-0.5 block text-[10px] tabular-nums">
                                    {Math.round(efficiency).toLocaleString()}{" "}
                                    runs/$
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <p className="border-border bg-bg-subtle text-subtle shrink-0 border-t px-4 py-2.5 text-[11px]">
                Live gateway pricing · per run ≈{" "}
                {(TYPICAL_RUN.inputTokens / 1000).toFixed(0)}k in /{" "}
                {(TYPICAL_RUN.outputTokens / 1000).toFixed(0)}k out
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function ProviderRow({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-control flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition-colors ${
        active
          ? "bg-surface-2 text-foreground font-medium"
          : "text-muted hover:bg-surface-hover hover:text-foreground"
      }`}
    >
      {icon && <span className="text-subtle shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-subtle shrink-0 text-[11px] tabular-nums">
        {count}
      </span>
    </button>
  );
}

/** Tier is signalled by shape and label, not hue — the icons stay greyscale. */
function TierGlyph({ tier }: { tier: ModelTier }) {
  const Icon = TIER_ICON[tier];
  const tone = "border-border bg-surface-2 text-muted";
  return (
    <span
      title={TIER_HINTS[tier]}
      className={`rounded-control flex h-7 w-7 shrink-0 items-center justify-center border ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
