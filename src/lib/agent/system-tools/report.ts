import { tool } from "ai";
import { buildReportSchema, normalizeEnvelope } from "@/lib/outcome/envelope";
import type { SystemToolContext } from "./context";

/**
 * How a run ends.
 *
 * Previously the run's outcome was `result.text` plus a string match on
 * "NO_UPDATES" — a convention, not a protocol, and one that could not carry
 * measured values at all. A tool call is validated at the point of the call,
 * so a malformed outcome comes back to the model as an error it can fix on the
 * next step rather than as a dead run nobody sees until morning.
 *
 * Unlike `query` and `inspect` this does NOT consult the shared read budget.
 * Refusing the report because the model read too much would throw away the
 * run's entire output over a budget that exists to bound reading.
 */
export function createReportTool(ctx: SystemToolContext) {
  const declared = ctx.signals;

  const signalHelp = declared.length
    ? ` Fill these signals when you can: ${declared
        .map((d) => `${d.key} (${d.type})`)
        .join(", ")}.`
    : "";

  return tool({
    description:
      "Report this run's result. Call this exactly once, as your final action. " +
      "Pass the markdown digest a human will read, or no_updates: true when " +
      `nothing has changed since the previous digest.${signalHelp}`,
    inputSchema: buildReportSchema(declared),
    execute: async (input) => {
      const outcome = normalizeEnvelope(input, declared);
      if (!outcome.ok) return { error: outcome.error };
      ctx.setEnvelope(outcome.envelope);
      return { ok: true, recorded: true };
    },
  });
}
