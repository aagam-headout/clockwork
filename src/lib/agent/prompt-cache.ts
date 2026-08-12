import type { SystemModelMessage } from "ai";

/** The provider-options shape a system message accepts, without reaching past `ai` for it. */
type SystemProviderOptions = NonNullable<SystemModelMessage["providerOptions"]>;

/*
 * Provider prompt caching for the run loop.
 *
 * The run loop's cost is dominated by re-sent prefix, not by new content. Every
 * step — including the free-of-budget `query`/`inspect` calls — resends the
 * whole tool-schema block and the whole system prompt, and a Composio toolkit's
 * schemas alone run to tens of thousands of tokens. A ten-step run pays for
 * that prefix ten times.
 *
 * Anthropic assembles a request as tools, then system, then messages, and a
 * `cache_control` breakpoint caches everything up to and including the block it
 * sits on. So a single breakpoint on the system message covers both the tool
 * schemas and the system prompt — the entire static prefix — and every step
 * after the first reads it at the cached rate.
 *
 * This is only sound because `systemPrompt` is deliberately static per workflow
 * (see the comment above it): a prefix that changed per run would never hit.
 *
 * OpenAI caches long prefixes automatically with no request-side opt-in, so
 * this is a no-op there rather than something that needs a second code path.
 * The AI Gateway forwards provider options under the provider's own key, so an
 * Anthropic model served through the gateway gets the same breakpoint.
 */

/** Escape hatch, mirroring `HANDLES_ENABLED`. */
export function promptCacheEnabled(): boolean {
  return process.env.PROMPT_CACHE_ENABLED !== "false";
}

/**
 * Provider options marking the end of the cacheable prefix.
 *
 * Deliberately the default 5-minute TTL rather than the 1-hour one: the win
 * being bought is the many steps *inside* one run, which land seconds apart.
 * Runs of the same workflow are usually hours apart, so a longer TTL would
 * mostly pay to keep a prefix warm that nothing reads.
 */
export function systemCacheOptions(): SystemProviderOptions | undefined {
  if (!promptCacheEnabled()) return undefined;
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}
