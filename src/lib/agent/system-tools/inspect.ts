import { tool } from "ai";
import { z } from "zod";
import { runQuery } from "../query";
import { describeShape, sampleOf } from "../shape";
import type { SystemToolContext } from "./context";

/** Shows shape and a sample of a stored payload, without its rows. */
export function createInspectTool(ctx: SystemToolContext) {
  return tool({
    description:
      "Show the structure and a short sample of a stored tool result, without returning its rows. Does not spend your step budget.",
    inputSchema: z.object({
      handle: z.string(),
      path: z.string().optional(),
    }),
    execute: async ({ handle, path }) => {
      const spent = ctx.budgetSpent();
      if (spent) return spent;

      const found = ctx.store.get(handle);
      if (!found.ok) {
        if (found.evicted) ctx.markDegraded();
        return { error: found.error };
      }

      const outcome = runQuery(found.payload, { path });
      if (!outcome.ok) {
        return { error: outcome.error, shape_at_path: outcome.shapeAtPath };
      }
      return {
        shape: describeShape(outcome.value),
        sample: sampleOf(outcome.value),
      };
    },
  });
}
