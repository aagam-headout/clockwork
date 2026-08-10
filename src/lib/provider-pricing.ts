// USD per 1M tokens, keyed by model-id prefix.
//
// The Vercel AI Gateway publishes live pricing with its catalog; Anthropic's
// and OpenAI's own /v1/models endpoints publish none. So when a direct
// provider is active, the model *list* is still live and only the prices come
// from here — a model this table doesn't cover shows up in the picker with no
// cost, which reads honestly as "unknown" rather than "free".
//
// Longest prefix wins, so a family entry ("claude-sonnet") can sit under a
// specific one ("claude-sonnet-4-5") without shadowing it.

export type Price = {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
};

/*
 * Anthropic bills cache *reads* at 0.1x input across the current lineup, so the
 * cached rate is derived rather than repeated on every row.
 */
const claude = (input: number, output: number): Price => ({
  inputPerM: input,
  outputPerM: output,
  cachedInputPerM: input * 0.1,
});

const ANTHROPIC_PRICES: Record<string, Price> = {
  "claude-fable-5": claude(10, 50),
  "claude-mythos-5": claude(10, 50),
  "claude-opus-5": claude(5, 25),
  "claude-opus-4-8": claude(5, 25),
  "claude-opus-4-7": claude(5, 25),
  "claude-opus-4-6": claude(5, 25),
  "claude-opus-4-5": claude(5, 25),
  "claude-opus-4": claude(15, 75),
  "claude-opus": claude(15, 75),
  "claude-sonnet-5": claude(3, 15),
  "claude-sonnet-4-6": claude(3, 15),
  "claude-sonnet-4-5": claude(3, 15),
  "claude-sonnet": claude(3, 15),
  "claude-haiku-4-5": claude(1, 5),
  "claude-3-5-haiku": claude(0.8, 4),
  "claude-3-haiku": claude(0.25, 1.25),
  "claude-haiku": claude(1, 5),
};

const OPENAI_PRICES: Record<string, Price> = {
  "gpt-5-nano": { inputPerM: 0.05, outputPerM: 0.4, cachedInputPerM: 0.005 },
  "gpt-5-mini": { inputPerM: 0.25, outputPerM: 2, cachedInputPerM: 0.025 },
  "gpt-5": { inputPerM: 1.25, outputPerM: 10, cachedInputPerM: 0.125 },
  "gpt-4.1-nano": { inputPerM: 0.1, outputPerM: 0.4, cachedInputPerM: 0.025 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6, cachedInputPerM: 0.1 },
  "gpt-4.1": { inputPerM: 2, outputPerM: 8, cachedInputPerM: 0.5 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6, cachedInputPerM: 0.075 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10, cachedInputPerM: 1.25 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4, cachedInputPerM: 0.275 },
  "o3-mini": { inputPerM: 1.1, outputPerM: 4.4, cachedInputPerM: 0.55 },
  o3: { inputPerM: 2, outputPerM: 8, cachedInputPerM: 0.5 },
};

const TABLES: Record<string, Record<string, Price>> = {
  anthropic: ANTHROPIC_PRICES,
  openai: OPENAI_PRICES,
};

/** Price for a bare model slug (no `provider/` prefix), or undefined. */
export function priceFor(provider: string, slug: string): Price | undefined {
  const table = TABLES[provider];
  if (!table) return undefined;

  let best: { key: string; price: Price } | undefined;
  for (const [key, price] of Object.entries(table)) {
    if (!slug.startsWith(key)) continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best?.price;
}
