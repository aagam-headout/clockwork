import type { SystemModelMessage } from "ai";

/** The provider-options shape a system message accepts, without reaching past `ai` for it. */
type SystemProviderOptions = NonNullable<SystemModelMessage["providerOptions"]>;

/*
 * Provider prompt caching for the run loop.
 *
 * The run loop's cost is dominated by re-sent prefix, not new content: every
 * step — including free `query`/`inspect` calls — resends the whole
 * tool-schema block and system prompt, and a Composio toolkit's schemas alone
 * run to tens of thousands of tokens. A ten-step run pays for that prefix ten
 * times.
 *
 * Anthropic assembles a request as tools, then system, then messages, and a
 * `cache_control` breakpoint caches everything up to and including the block
 * it sits on. So one breakpoint on the system message covers the tool schemas
 * and system prompt — the entire static prefix — and every step after the
 * first reads it at the cached rate.
 *
 * Only sound because `systemPrompt` is static per workflow (see the comment
 * above it): a prefix that changed per run would never hit.
 *
 * OpenAI caches long prefixes automatically with no opt-in, so this is a
 * no-op there. The AI Gateway forwards provider options under the provider's
 * own key, so an Anthropic model served through the gateway gets the same
 * breakpoint.
 */

/** Escape hatch, mirroring `HANDLES_ENABLED`. */
export function promptCacheEnabled(): boolean {
  return process.env.PROMPT_CACHE_ENABLED !== "false";
}

/**
 * Provider options marking the end of the cacheable prefix.
 *
 * Deliberately the default 5-minute TTL, not the 1-hour one: the win is the
 * many steps *inside* one run, landing seconds apart. Runs of the same
 * workflow are usually hours apart, so a longer TTL would mostly keep a
 * prefix warm that nothing reads.
 */
export function systemCacheOptions(): SystemProviderOptions | undefined {
  if (!promptCacheEnabled()) return undefined;
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}
