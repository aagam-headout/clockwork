"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, Check, LoaderCircle, Zap, Gauge, Brain, ChevronsUpDown } from "lucide-react";
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

const TIER_ICON: Record<ModelTier, React.ComponentType<{ className?: string }>> = {
  light: Zap,
  mid: Gauge,
  heavy: Brain,
};

const TIER_TONE: Record<ModelTier, "success" | "accent" | "warn"> = {
  light: "success",
  mid: "accent",
  heavy: "warn",
};

type Filter = "recommended" | ModelTier | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "recommended", label: "Light + Mid" },
  { key: "light", label: "Light" },
  { key: "mid", label: "Mid" },
  { key: "heavy", label: "Heavy" },
  { key: "all", label: "All" },
];

/**
 * Model selector: a trigger button showing the current pick and its cost, and
 * a searchable modal over the full AI Gateway catalog. The value is submitted
 * through a hidden input, so the surrounding <form action> keeps working
 * exactly as it did with a native <select>.
 */
export function ModelPicker({
  name = "model",
  defaultValue,
  initialModels,
}: {
  name?: string;
  defaultValue?: string;
  initialModels: ModelInfo[];
}) {
  const [models, setModels] = useState<ModelInfo[]>(initialModels);
  const [selectedId, setSelectedId] = useState(
    defaultValue ?? initialModels.find((m) => m.tier === "mid")?.id ?? initialModels[0]?.id ?? ""
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("recommended");
  const [loading, setLoading] = useState(false);

  const selected =
    models.find((m) => m.id === selectedId) ??
    ({ id: selectedId, name: selectedId, provider: "", tier: "mid" } as ModelInfo);

  // Refresh the catalog on open: the server-rendered list is a snapshot, and
  // pricing/availability changes without a redeploy. Done in the click handler
  // rather than an effect so opening doesn't cascade renders.
  async function openPicker() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) setModels(data.items);
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      const tierOk =
        filter === "all"
          ? true
          : filter === "recommended"
            ? m.tier === "light" || m.tier === "mid"
            : m.tier === filter;
      if (!tierOk) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });
  }, [models, query, filter]);

  const counts = useMemo(
    () => ({
      light: models.filter((m) => m.tier === "light").length,
      mid: models.filter((m) => m.tier === "mid").length,
      heavy: models.filter((m) => m.tier === "heavy").length,
    }),
    [models]
  );

  return (
    <>
      <input type="hidden" name={name} value={selectedId} />

      <button
        type="button"
        onClick={openPicker}
        className="flex w-full cursor-pointer items-center gap-2 rounded-control border border-border bg-bg px-2.5 py-2 text-left transition-colors hover:border-border-strong"
      >
        <TierGlyph tier={selected.tier} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {selected.name}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-subtle">
            {selected.blendedPerM != null
              ? `${formatUsd(selected.blendedPerM)}/1M · ≈${formatUsd(costPerRun(selected))} per run`
              : selected.id}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-subtle" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <button
            type="button"
            aria-label="Close model picker"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-bg/60 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a model"
            className="rise relative flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-container border border-border bg-surface shadow-pop"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-subtle" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
              />
              {loading && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-subtle" />}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const count =
                  f.key === "all"
                    ? models.length
                    : f.key === "recommended"
                      ? counts.light + counts.mid
                      : counts[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    title={f.key in TIER_HINTS ? TIER_HINTS[f.key as ModelTier] : undefined}
                    className={`h-7 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors ${
                      active
                        ? "border-foreground bg-surface-2 text-foreground"
                        : "border-border text-muted hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {f.label}
                    <span className="ml-1 tabular-nums opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-muted">
                  No model matches “{query}”.
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
                            setSelectedId(model.id);
                            setOpen(false);
                          }}
                          className={`flex w-full cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                            isSelected ? "bg-surface-2" : "hover:bg-surface-hover"
                          }`}
                        >
                          <TierGlyph tier={model.tier} />

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {model.name}
                              </span>
                              <Badge tone={TIER_TONE[model.tier]}>
                                {TIER_LABELS[model.tier]}
                              </Badge>
                              {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-subtle">
                              {model.id}
                            </span>

                            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-muted">
                              <span>in {formatUsd(model.inputPerM)}/1M</span>
                              <span>out {formatUsd(model.outputPerM)}/1M</span>
                              {model.cachedInputPerM != null && (
                                <span>cached {formatUsd(model.cachedInputPerM)}/1M</span>
                              )}
                            </span>
                          </span>

                          <span className="shrink-0 text-right">
                            <span className="block text-[12px] font-semibold tabular-nums text-foreground">
                              {formatUsd(perRun)}
                            </span>
                            <span className="block text-[10px] text-subtle">per run</span>
                            {efficiency != null && (
                              <span className="mt-0.5 block text-[10px] tabular-nums text-subtle">
                                {Math.round(efficiency).toLocaleString()} runs/$
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

            <p className="border-t border-border bg-bg-subtle px-3 py-2 text-[11px] text-subtle">
              Live gateway pricing · per run ≈ {(TYPICAL_RUN.inputTokens / 1000).toFixed(0)}k in /{" "}
              {(TYPICAL_RUN.outputTokens / 1000).toFixed(0)}k out
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function TierGlyph({ tier }: { tier: ModelTier }) {
  const Icon = TIER_ICON[tier];
  const tone =
    tier === "light"
      ? "border-success-line bg-success-soft text-success-text"
      : tier === "mid"
        ? "border-accent-line bg-accent-soft text-accent-text"
        : "border-warn-line bg-warn-soft text-warn-text";
  return (
    <span
      title={TIER_HINTS[tier]}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control border ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
