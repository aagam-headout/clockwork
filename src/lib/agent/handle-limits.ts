/**
 * Shared size/budget limits: threshold for turning a payload into a handle,
 * how much a paged `query` read returns, and system-tool calls per run.
 *
 * Kept separate from `wrap-tools.ts` and `system-tools/` so neither has to
 * import the other just to read a number.
 */

export const HANDLE_THRESHOLD_CHARS = 2_000;
export const MAX_QUERIES_PER_RUN = 15;

/** How much of a long text value one `query` call returns. */
export const MAX_STRING_SLICE_CHARS = 1_500;
