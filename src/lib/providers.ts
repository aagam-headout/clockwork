// Client-safe provider metadata: ids, labels, env var names. No SDK imports,
// so the settings UI can render the toggle without pulling three provider
// packages into the browser bundle. The SDK wiring lives in `provider.ts`.

export const PROVIDER_IDS = ["gateway", "anthropic", "openai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_PROVIDER: ProviderId = "gateway";

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  /** Env var that must be set for this provider to route anything. */
  envVar: string;
  description: string;
  /** Used when a workflow's stored model isn't offered by this provider. */
  defaultModel: string;
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    envVar: "AI_GATEWAY_API_KEY",
    description:
      "One key, every provider's catalog, live per-token pricing. The default.",
    defaultModel: "anthropic/claude-sonnet-5",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    description:
      "Straight to api.anthropic.com. Claude models only; pricing comes from a table in the repo.",
    defaultModel: "anthropic/claude-sonnet-4-5",
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    description:
      "Straight to api.openai.com. GPT/o-series only; pricing comes from a table in the repo.",
    defaultModel: "openai/gpt-5",
  },
];

export function providerMeta(id: ProviderId): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId)
  );
}

/**
 * Model ids are stored gateway-style everywhere — `anthropic/claude-sonnet-5`
 * — even when a direct provider is active, so switching providers never
 * rewrites a row. This splits one back into its parts.
 */
export function splitModelId(id: string): { provider: string; slug: string } {
  const at = id.indexOf("/");
  return at === -1
    ? { provider: "", slug: id }
    : { provider: id.slice(0, at), slug: id.slice(at + 1) };
}

/**
 * True if a stored model id can be routed by this provider. The gateway routes
 * everything; a direct provider only routes its own namespace.
 */
export function providerRoutes(provider: ProviderId, modelId: string): boolean {
  if (provider === "gateway") return true;
  return splitModelId(modelId).provider === provider;
}
