import { tool } from "ai";
import { z } from "zod";
import { runQuery, type QuerySpec } from "../query";
import {
  HANDLE_THRESHOLD_CHARS,
  MAX_STRING_SLICE_CHARS,
} from "../handle-limits";
import type { SystemToolContext } from "./context";

const whereSchema = z.object({
  field: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  contains: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
});

/** Reads part of a stored payload by handle. See `HANDLE_PROMPT` (./index.ts) for the model-facing contract this and `inspect` share. */
export function createQueryTool(ctx: SystemToolContext) {
  return tool({
    description:
      "Read part of a stored tool result by its handle. Does not spend your step budget and makes no external call, but it is still a round trip — ask for what you need in one call.",
    inputSchema: z.object({
      handle: z.string().describe('A handle from a tool result, e.g. "r1".'),
      path: z
        .string()
        .optional()
        .describe('Dot path into the payload, e.g. "items".'),
      pick: z
        .array(z.string())
        .optional()
        .describe("Fields to keep on each row."),
      where: whereSchema.optional(),
      sort: z
        .object({
          field: z.string(),
          direction: z.enum(["asc", "desc"]).optional(),
        })
        .optional(),
      take: z.number().int().positive().optional(),
      count: z
        .boolean()
        .optional()
        .describe("Return only how many rows match."),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Rows or characters to skip before `take` — use it with the `offset`/`total`/`truncated` in the reply to read the next page, whether the value is a long list or a long text.",
        ),
    }),
    execute: async ({ handle, offset = 0, ...rest }) => {
      const spent = ctx.budgetSpent();
      if (spent) return spent;

      const found = ctx.store.get(handle);
      if (!found.ok) {
        if (found.evicted) ctx.markDegraded();
        return { error: found.error };
      }

      const spec: QuerySpec = { ...rest, offset };
      const outcome = runQuery(found.payload, spec);
      if (!outcome.ok) {
        return { error: outcome.error, shape_at_path: outcome.shapeAtPath };
      }

      const { value, total, truncated } = outcome;

      /*
       * A long text must never come back as a handle. There's no narrowing
       * op for a string — `path` can't index into it, `take` only applies to
       * arrays — so re-handling one loops the agent through its whole budget
       * without yielding a single character. A bounded slice with its own
       * offset is the only answer that terminates.
       */
      if (typeof value === "string") {
        // Raw length, not JSON.stringify just to measure it — quoting adds at
        // most a few chars, well within this threshold's slack.
        const oversized = value.length >= HANDLE_THRESHOLD_CHARS;
        if (oversized || offset > 0) {
          const slice = value.slice(offset, offset + MAX_STRING_SLICE_CHARS);
          return {
            value: slice,
            truncated: offset + slice.length < value.length,
            offset,
            total: value.length,
          };
        }
        return { value };
      }

      // Other scalars are small by construction and handed back whole — only
      // a container is worth re-handling.
      if (value === null || typeof value !== "object") return { value };

      // `total`/`truncated` are present only when `offset`/`take` actually
      // paged an array, and carried through either return shape below, so a
      // paging model sees the same signal regardless of re-handling.
      const page = total === undefined ? {} : { total, truncated };

      // A narrowing still too huge gets the same treatment as a tool result,
      // so the agent can narrow again instead of blowing the budget.
      const json = JSON.stringify(value) ?? "";
      if (json.length >= HANDLE_THRESHOLD_CHARS) {
        return { ...ctx.store.put(`query(${handle})`, value, json), ...page };
      }
      return { value, ...page };
    },
  });
}
