// Client-safe: no gateway import, so the chat header and the propose route can
// both refer to the builder's default without pulling the SDK into the bundle.

/**
 * What the assistant thinks with when the user hasn't picked anything. The
 * choice itself is not a shortlist — the header opens the same full gateway
 * catalog the workflow's own model picker uses, and the route validates the id
 * against that live catalog rather than a hardcoded list.
 */
export const DEFAULT_BUILDER_MODEL = "anthropic/claude-sonnet-5";

/** Steps the research phase may take before the spec is written. */
export const BUILDER_RESEARCH_STEPS = 5;
