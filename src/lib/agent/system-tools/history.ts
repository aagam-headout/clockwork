import { tool } from "ai";
import { z } from "zod";
import {
  MAX_SEARCH_LIMIT,
  parseSince,
  searchDigests,
} from "@/lib/data/digest-search";
import type { SystemToolContext } from "./context";

/**
 * Lets a run read its own past digests.
 *
 * Previously a run's only memory was the one prior digest, so it could say
 * "this changed since yesterday" but never "third week running" — the
 * observation that matters most in monitoring.
 *
 * Owner and default workflow come from the run, never an argument. `scope`
 * only chooses between this workflow and all of the same owner's workflows —
 * nothing the model passes can reach another account's digests.
 */
export function createHistoryTool(ctx: SystemToolContext) {
  return tool({
    description:
      "Search this workflow's own past digests. Use it to tell a one-off from a trend, or to check whether something was already reported. Does not spend your step budget.",
    inputSchema: z.object({
      q: z
        .string()
        .optional()
        .describe("Words to search for. Omit to get the most recent digests."),
      since: z
        .string()
        .optional()
        .describe('How far back, e.g. "30d", "2w", "6m".'),
      scope: z
        .enum(["workflow", "user"])
        .optional()
        .describe(
          "'workflow' (default) searches this workflow's digests; 'user' searches all of this account's workflows.",
        ),
      limit: z.number().int().optional().describe("Up to 50. Default 10."),
    }),
    execute: async ({ q, since, scope, limit }) => {
      const spent = ctx.historySpent();
      if (spent) return spent;

      const window = parseSince(since);
      if (!window.ok) return { error: window.error };

      let hits;
      try {
        hits = await searchDigests({
          userId: ctx.ownerId,
          workflowId: scope === "user" ? undefined : ctx.workflowId,
          q,
          since: window.date,
          limit,
        });
      } catch {
        /*
         * History is supporting context, not the work — a failed search must
         * not take the run down with it.
         */
        return {
          error:
            "history is unavailable this run — continue without it and do not retry",
        };
      }

      if (hits.length === 0) {
        // Explicit sentence, not `[]` — a model may read an empty array as a
        // failure and retry.
        return { result: "No prior digests match that search.", count: 0 };
      }

      return {
        count: hits.length,
        ...(limit && limit > MAX_SEARCH_LIMIT
          ? { note: `limit clamped to ${MAX_SEARCH_LIMIT}` }
          : {}),
        results: hits.map((hit) => ({
          date: hit.date.toISOString().slice(0, 10),
          workflow: hit.workflowName,
          excerpt: hit.excerpt,
          ...(hit.signals ? { signals: hit.signals } : {}),
          ...(hit.severity ? { severity: hit.severity } : {}),
        })),
      };
    },
  });
}
