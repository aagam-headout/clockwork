import { tool } from "ai";
import { buildReportSchema, normalizeEnvelope } from "@/lib/outcome/envelope";
import type { SystemToolContext } from "./context";

/**
 * How a run ends.
 *
 * Previously the outcome was `result.text` plus a string match on
 * "NO_UPDATES" — a convention, not a protocol, and one that couldn't carry
 * measured values. Validating at the call site means a malformed outcome
 * comes back as an error the model can fix next step, not a dead run nobody
 * sees until morning.
 *
 * Unlike `query`/`inspect` this does NOT consult the shared read budget —
 * refusing the report over a budget meant to bound reading would throw away
 * the run's entire output.
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
