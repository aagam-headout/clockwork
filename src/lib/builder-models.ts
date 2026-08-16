// Client-safe: no gateway import, so the chat header and the propose route can
// both refer to the builder's default without pulling the SDK into the bundle.

/**
 * What the assistant thinks with when the user hasn't picked anything.
 */
export const DEFAULT_BUILDER_MODEL = "anthropic/claude-sonnet-5";

/*
 * The builder is the hardest job in the app: hold a multi-turn conversation,
 * decide when it has enough to commit, call read tools, and emit a valid
 * structured spec. Small models fail in ways the user only discovers after a
 * bad workflow runs for a week — so unlike the *workflow's* model (where the
 * whole catalog is fair game and cheap is usually right), this picker is
 * limited to frontier-class families that reliably do tool use + structured
 * output.
 *
 * Matched by id prefix against live gateway slugs, so new point releases in a
 * family (…-5.1, …-4-6) qualify automatically without a redeploy.
 */
const BUILDER_FAMILIES: RegExp[] = [
  /^anthropic\/claude-(opus|sonnet)/,
  /^openai\/(gpt-5|o[34])/,
  /^google\/gemini-[\d.]+-pro/,
  /^xai\/grok-\d/,
  /^deepseek\/deepseek-(r1|v[34])/,
  /^moonshotai\/kimi-k\d/,
  /^alibaba\/qwen3-max/,
  /^zai\/glm-[45]/,
  /^mistral\/mistral-large/,
];

/*
 * Every family above also ships small, fast, or narrow variants under the same
 * prefix — gpt-5-nano, glm-4.6v-flash, grok-4.1-fast-non-reasoning — exactly
 * the ones that lose the thread mid-conversation, so they're excluded.
 * Codex/image/deep-research go too: specialized, not conversational.
 *
 * Matched per name segment, never as a substring: "gemini" ends in "mini", and
 * a substring test would silently drop every Gemini Pro.
 */
const NOT_BUILDER_SEGMENTS = new Set([
  "nano",
  "mini",
  "flash",
  "lite",
  "air",
  "instant",
  "tiny",
  "fast",
  "chat",
  "codex",
  "image",
  "beta",
  "highspeed",
]);

const NOT_BUILDER_PHRASES = [/non-reasoning/, /deep-research/];

/** Stems providers decorate: "flashx", "lite-preview". */
const NOT_BUILDER_STEMS = ["flash", "lite", "nano", "mini"];

/** True if this model is capable enough to drive the builder conversation. */
export function isBuilderModel(id: string): boolean {
  const slug = id.slice(id.indexOf("/") + 1);
  if (NOT_BUILDER_PHRASES.some((phrase) => phrase.test(slug))) return false;
  const segments = slug.split(/[-.]/);
  // `4v`, `5v`: vision variants of a text model, weaker at plain reasoning.
  const downgraded = segments.some(
    (s) =>
      NOT_BUILDER_SEGMENTS.has(s) ||
      /^\d+v$/.test(s) ||
      NOT_BUILDER_STEMS.some((stem) => s.startsWith(stem)),
  );
  if (downgraded) return false;
  return BUILDER_FAMILIES.some((pattern) => pattern.test(id));
}

/**
 * Narrows a catalog to builder-capable models. Falls back to the full catalog
 * if nothing matches — a gateway that renamed everything should leave the
 * picker usable rather than empty.
 */
export function builderModels<T extends { id: string }>(catalog: T[]): T[] {
  const capable = catalog.filter((m) => isBuilderModel(m.id));
  return capable.length > 0 ? capable : catalog;
}

/**
 * The builder model to start on, given the catalog the active provider serves.
 * `DEFAULT_BUILDER_MODEL` is Anthropic-flavoured, so it isn't routable at all
 * under a direct OpenAI provider — fall back to the cheapest capable model
 * that provider offers.
 */
export function defaultBuilderModel<T extends { id: string }>(
  catalog: T[],
): string {
  if (catalog.some((m) => m.id === DEFAULT_BUILDER_MODEL)) {
    return DEFAULT_BUILDER_MODEL;
  }
  return builderModels(catalog)[0]?.id ?? DEFAULT_BUILDER_MODEL;
}

/** Steps the research phase may take before the spec is written. */
export const BUILDER_RESEARCH_STEPS = 5;
