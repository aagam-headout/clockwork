/**
 * Shared size/budget limits for the handle system: how big a connector-tool
 * payload must be before it becomes a handle, how much of a paged read comes
 * back per `query` call, and how many system-tool calls one run gets.
 *
 * Kept separate from both `wrap-tools.ts` (which wraps connector tools) and
 * `system-tools/` (which defines `query`/`inspect`) so neither has to import
 * the other just to read a number.
 */

export const HANDLE_THRESHOLD_CHARS = 2_000;
export const MAX_QUERIES_PER_RUN = 15;

/** How much of a long text value one `query` call returns. */
export const MAX_STRING_SLICE_CHARS = 1_500;
