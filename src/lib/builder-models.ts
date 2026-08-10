// Client-safe: no gateway import, so the chat header and the propose route
// share one definition of "models good enough to build a workflow with".

/**
 * The builder writes a whole spec in one structured-output call — it needs
 * models that are reliable at tool/JSON reasoning, not the cheapest thing on
 * the gateway. This is a preference-ordered shortlist, not a hard catalog: ids
 * are intersected with what the gateway actually reports before being offered,
 * so a model going away here is a shorter list, never a broken picker.
 */
export const BUILDER_MODEL_IDS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.1",
  "openai/gpt-5",
  "google/gemini-3-pro",
  "google/gemini-2.5-flash",
  "xai/grok-4",
] as const;

export const DEFAULT_BUILDER_MODEL = "anthropic/claude-sonnet-5";

/** True if `id` is one the builder is allowed to run on. */
export function isBuilderModel(id: unknown): id is string {
  return (
    typeof id === "string" &&
    (BUILDER_MODEL_IDS as readonly string[]).includes(id)
  );
}
