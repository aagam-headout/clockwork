// Client-safe model helpers: no gateway/SDK imports, so both the server
// catalog loader and the picker UI can share one definition of "tier" and
// one cost formula.

export type ModelTier = "light" | "mid" | "heavy";

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  description?: string;
  /** USD per 1M tokens. Undefined when the gateway reports no pricing. */
  inputPerM?: number;
  outputPerM?: number;
  cachedInputPerM?: number;
  /** Weighted cost of a typical agent run — see BLEND below. */
  blendedPerM?: number;
  tier: ModelTier;
};

/*
 * A workflow run is prompt-heavy: a long tool-result transcript in, a short
 * digest out. Blending 4:1 in favour of input reflects that far better than
 * averaging the two prices, so cheap-input models rank where they belong.
 */
const BLEND = { input: 0.8, output: 0.2 };

/** Tokens a typical digest run burns — used for the per-run cost estimate. */
export const TYPICAL_RUN = { inputTokens: 20_000, outputTokens: 1_000 };

export function blendedPerM(
  inputPerM?: number,
  outputPerM?: number,
): number | undefined {
  if (inputPerM == null || outputPerM == null) return undefined;
  return inputPerM * BLEND.input + outputPerM * BLEND.output;
}

/**
 * Price bands, in blended USD per 1M tokens. Anything without pricing is
 * treated as mid — unknown cost shouldn't get promoted into the cheap tier.
 */
export function tierFor(blended?: number): ModelTier {
  if (blended == null) return "mid";
  if (blended <= 1.5) return "light";
  if (blended <= 8) return "mid";
  return "heavy";
}

export const TIER_LABELS: Record<ModelTier, string> = {
  light: "Light",
  mid: "Mid",
  heavy: "Heavy",
};

export const TIER_HINTS: Record<ModelTier, string> = {
  light: "≤ $1.50 / 1M blended — cheap enough to run hourly",
  mid: "$1.50–$8 / 1M blended — the default for daily digests",
  heavy: "> $8 / 1M blended — only for deep multi-tool reasoning",
};

/** USD for one typical run at this model's prices. */
export function costPerRun(model: ModelInfo): number | undefined {
  if (model.inputPerM == null || model.outputPerM == null) return undefined;
  return (
    (model.inputPerM * TYPICAL_RUN.inputTokens +
      model.outputPerM * TYPICAL_RUN.outputTokens) /
    1_000_000
  );
}

/** Compact money formatting: sub-cent values need more precision than dollars. */
export function formatUsd(value?: number): string {
  if (value == null) return "—";
  if (value === 0) return "free";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value)}`;
}

/** Runs per dollar — the "efficiency" number, higher is better. */
export function runsPerDollar(model: ModelInfo): number | undefined {
  const cost = costPerRun(model);
  if (!cost) return undefined;
  return 1 / cost;
}
