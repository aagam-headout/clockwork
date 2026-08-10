import { gateway } from "@ai-sdk/gateway";
import { blendedPerM, tierFor, type ModelInfo } from "@/lib/model-tiers";
import { priceFor } from "@/lib/provider-pricing";
import { getProviderFor, providerConfigured } from "@/lib/provider";
import { currentUserEmail } from "@/lib/auth/require-owner";
import { providerMeta, type ProviderId } from "@/lib/providers";

/*
 * Model catalog for whichever provider is switched on in Settings.
 *
 * Gateway: every language model it can route to, with live per-token pricing.
 * Anthropic/OpenAI: the provider's own live model list, priced from the table
 * in `provider-pricing.ts` — neither publishes prices over the API.
 *
 * Memoized for an hour, per provider, because the picker re-fetches on open
 * and the list barely moves.
 */
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<ProviderId, { at: number; items: ModelInfo[] }>();

/** Used when a provider is unreachable (e.g. no credentials locally). */
export const FALLBACK_MODELS: Record<ProviderId, ModelInfo[]> = {
  gateway: [
    fallback("anthropic/claude-haiku-4-5", "Claude Haiku 4.5"),
    fallback("anthropic/claude-sonnet-5", "Claude Sonnet 5"),
    fallback("anthropic/claude-opus-5", "Claude Opus 5"),
  ],
  anthropic: [
    fallback("anthropic/claude-haiku-4-5", "Claude Haiku 4.5"),
    fallback("anthropic/claude-sonnet-5", "Claude Sonnet 5"),
    fallback("anthropic/claude-opus-5", "Claude Opus 5"),
  ],
  openai: [
    fallback("openai/gpt-5-mini", "GPT-5 mini"),
    fallback("openai/gpt-5", "GPT-5"),
    fallback("openai/o3", "o3"),
  ],
};

/** A catalog entry priced from the static table, for use without a network call. */
function fallback(id: string, name: string): ModelInfo {
  const [provider, ...rest] = id.split("/");
  return describe(id, name, provider, rest.join("/"));
}

/** Assembles a ModelInfo from the static price table. */
function describe(
  id: string,
  name: string,
  provider: string,
  slug: string,
  description?: string,
): ModelInfo {
  const price = priceFor(provider, slug);
  const blended = blendedPerM(price?.inputPerM, price?.outputPerM);
  return {
    id,
    name,
    provider,
    description,
    inputPerM: price?.inputPerM,
    outputPerM: price?.outputPerM,
    cachedInputPerM: price?.cachedInputPerM,
    blendedPerM: blended,
    tier: tierFor(blended),
  };
}

const perMillion = (perToken?: string) =>
  perToken == null ? undefined : Number(perToken) * 1_000_000;

const byPrice = (a: ModelInfo, b: ModelInfo) =>
  (a.blendedPerM ?? Infinity) - (b.blendedPerM ?? Infinity);

async function gatewayCatalog(): Promise<ModelInfo[]> {
  const { models } = await gateway.getAvailableModels();

  return (
    models
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
      .sort(byPrice)
  );
}

/** `GET /v1/models` on api.anthropic.com — live list, static prices. */
async function anthropicCatalog(): Promise<ModelInfo[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`anthropic /v1/models: ${res.status}`);

  const body = (await res.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
  };

  return (body.data ?? [])
    .map((m) =>
      describe(`anthropic/${m.id}`, m.display_name || m.id, "anthropic", m.id),
    )
    .sort(byPrice);
}

/*
 * OpenAI's list is everything the key can reach — embeddings, TTS, image,
 * moderation, realtime. Only the chat-completion families can drive a
 * workflow, so the list is narrowed to those and to their base variants
 * (dated snapshots and `-audio`/`-realtime` cuts are noise in a picker).
 */
const OPENAI_CHAT = /^(gpt-[45]|o[1345])(-|$)/;
const OPENAI_NOT_CHAT = /audio|realtime|search|transcribe|tts|image|instruct/;
const OPENAI_DATED = /-\d{4}-\d{2}-\d{2}$/;

async function openaiCatalog(): Promise<ModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
  });
  if (!res.ok) throw new Error(`openai /v1/models: ${res.status}`);

  const body = (await res.json()) as { data?: Array<{ id: string }> };

  return (body.data ?? [])
    .map((m) => m.id)
    .filter(
      (id) =>
        OPENAI_CHAT.test(id) &&
        !OPENAI_NOT_CHAT.test(id) &&
        !OPENAI_DATED.test(id),
    )
    .map((id) => describe(`openai/${id}`, id, "openai", id))
    .sort(byPrice);
}

/**
 * The catalog for one account's provider. Background runs (cron, webhooks)
 * must use this and pass the workflow's owner — they have no session to read
 * a provider from.
 */
export async function getModelCatalogFor(
  email: string | null | undefined,
): Promise<ModelInfo[]> {
  const provider = await getProviderFor(email);

  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

  // No key means no list to fetch — the settings page says as much, and the
  // picker still has something routable to show.
  if (!providerConfigured(provider)) return FALLBACK_MODELS[provider];

  try {
    const items =
      provider === "anthropic"
        ? await anthropicCatalog()
        : provider === "openai"
          ? await openaiCatalog()
          : await gatewayCatalog();

    if (items.length === 0) return FALLBACK_MODELS[provider];

    cache.set(provider, { at: Date.now(), items });
    return items;
  } catch {
    // A model list is not worth failing a page render over.
    return FALLBACK_MODELS[provider];
  }
}

/** Drops every cached catalog — called when the active provider changes. */
export function clearModelCatalogCache() {
  cache.clear();
}

/** The catalog for the signed-in user — pages, actions and route handlers. */
export async function getModelCatalog(): Promise<ModelInfo[]> {
  return getModelCatalogFor(await currentUserEmail());
}

/** True if the id is a routable model — used to sanity-check agent output. */
export async function isKnownModel(id: string): Promise<boolean> {
  const catalog = await getModelCatalog();
  return catalog.some((m) => m.id === id);
}

/** The model a workflow gets when the active provider can't serve its own. */
export function providerDefaultModel(provider: ProviderId): string {
  return providerMeta(provider).defaultModel;
}
