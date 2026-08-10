import { gateway } from "@ai-sdk/gateway";
import { blendedPerM, tierFor, type ModelInfo } from "@/lib/model-tiers";

/*
 * Model catalog, straight from Vercel AI Gateway — every language model the
 * gateway can route to, with its live per-token pricing. Memoized for an hour
 * because the picker re-fetches on open and the list barely moves.
 */
const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; items: ModelInfo[] } | null = null;

/** Used when the gateway is unreachable (e.g. no credentials locally). */
export const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "anthropic/claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "light",
  },
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "anthropic",
    tier: "mid",
  },
  {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    provider: "anthropic",
    tier: "heavy",
  },
];

const perMillion = (perToken?: string) =>
  perToken == null ? undefined : Number(perToken) * 1_000_000;

export async function getModelCatalog(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;

  try {
    const { models } = await gateway.getAvailableModels();

    const items = models
      // The gateway also lists image/embedding/speech models; only text
      // generation models can back a workflow.
      .filter((m) => (m.modelType ?? "language") === "language")
      .map((m): ModelInfo => {
        const inputPerM = perMillion(m.pricing?.input);
        const outputPerM = perMillion(m.pricing?.output);
        const blended = blendedPerM(inputPerM, outputPerM);
        return {
          id: m.id,
          name: m.name || m.id,
          provider: m.specification?.provider ?? m.id.split("/")[0],
          description: m.description ?? undefined,
          inputPerM,
          outputPerM,
          cachedInputPerM: perMillion(m.pricing?.cachedInputTokens),
          blendedPerM: blended,
          tier: tierFor(blended),
        };
      })
      .sort((a, b) => (a.blendedPerM ?? Infinity) - (b.blendedPerM ?? Infinity));

    if (items.length === 0) return FALLBACK_MODELS;

    cache = { at: Date.now(), items };
    return items;
  } catch {
    // A model list is not worth failing a page render over.
    return FALLBACK_MODELS;
  }
}

/** True if the id is a routable model — used to sanity-check agent output. */
export async function isKnownModel(id: string): Promise<boolean> {
  const catalog = await getModelCatalog();
  return catalog.some((m) => m.id === id);
}
