import { createHash } from "node:crypto";
import type { ToolSet } from "ai";
import { canonicalHash, readToolHash } from "@/lib/data/tool-hashes";
import { isFailure } from "@/lib/connection-gate";
import { isDescriptor, type ResultStore } from "./result-store";
import { HANDLE_THRESHOLD_CHARS, MAX_QUERIES_PER_RUN } from "./handle-limits";
import type { HarnessState } from "./harness-state";
import { buildSystemTools, SYSTEM_TOOL_NAMES } from "./system-tools";

/*
 * Keeps large tool payloads out of the model's context.
 *
 * A Composio result routinely runs to tens of kilobytes, and the AI SDK
 * resends the whole message history on every step — so one big result at step 2
 * is billed again at every step after it. This wrapper stores the payload and
 * hands the model a descriptor instead; the model narrows it with `query`,
 * which is local and does not spend the run's step budget — though it is still
 * a model round trip, which is why the descriptor carries a preview.
 *
 * The tool itself always executes. Nothing here is a cache of *data* — only of
 * the knowledge that the data has not changed.
 *
 * This module owns two things: wrapping whatever *connector* tools a workflow
 * was given (Composio, MCP, ... — the ones in `SYSTEM_TOOL_NAMES` are not
 * these), and the run-loop step-budget math, which has to know both kinds of
 * tool to bound them correctly. The `query`/`inspect` tools themselves live in
 * `./system-tools` — see that module for why they're kept separate.
 */

// Re-exported for callers that imported these from here before the split.
export {
  HANDLE_THRESHOLD_CHARS,
  MAX_QUERIES_PER_RUN,
  MAX_STRING_SLICE_CHARS,
} from "./handle-limits";
export {
  createHarnessState,
  flushToolHashes,
  type HarnessState,
} from "./harness-state";
export { HANDLE_PROMPT } from "./system-tools";
/** @deprecated use `SYSTEM_TOOL_NAMES` from `./system-tools` */
export const LOCAL_TOOL_NAMES = SYSTEM_TOOL_NAMES;

export function handlesEnabled(): boolean {
  return process.env.HANDLES_ENABLED !== "false";
}

/** Steps that spent the workflow's budget: the ones that called a real tool. */
export function countExternalSteps(
  steps: Array<{ toolCalls?: Array<{ toolName: string }> }>,
): number {
  const local = new Set<string>(SYSTEM_TOOL_NAMES);
  return steps.filter((step) =>
    (step.toolCalls ?? []).some((call) => !local.has(call.toolName)),
  ).length;
}

/**
 * Whether the run loop must stop: either the workflow's real-tool-call
 * budget is spent, or an absolute ceiling on total steps is reached.
 *
 * The absolute bound exists because `query`/`inspect` are deliberately free
 * of `maxSteps` — but exhausting their own per-run budget doesn't remove
 * them from the tool set, it just makes them return an error value the model
 * can keep calling around. Without a second, unconditional bound, a model
 * that loops on local calls forever has nothing to stop it before the run's
 * hard timeout, and that run is then billed for every step and recorded as a
 * timeout error instead of an honest `truncated`. `MAX_QUERIES_PER_RUN + 2`
 * is slack for the one real tool-call step already counted toward `maxSteps`
 * when the cap trips, plus the loop's final text-only step.
 *
 * `stopWhen` and `hitStepCap` must never disagree about this — a mismatch
 * means a run that hit the cap gets recorded as a clean finish. Keeping the
 * arithmetic in one place is what keeps them from drifting apart.
 */
export function runLoopExhausted(
  steps: Array<{ toolCalls?: Array<{ toolName: string }> }>,
  maxSteps: number,
): boolean {
  return loopBoundHit(steps, maxSteps) !== null;
}

/**
 * Which bound stopped the loop, or `null` if neither has.
 *
 * The two are not interchangeable in the run row: "stopped after N steps" sent
 * to a run that actually looped on local calls tells the *next* run to plan
 * fewer fetches, which is the wrong lesson and makes the digest thinner for a
 * problem that was never about fetching.
 */
export type LoopBound = "external-steps" | "total-steps";

export function loopBoundHit(
  steps: Array<{ toolCalls?: Array<{ toolName: string }> }>,
  maxSteps: number,
): LoopBound | null {
  if (countExternalSteps(steps) >= maxSteps) return "external-steps";
  if (steps.length >= maxSteps + MAX_QUERIES_PER_RUN + 2) return "total-steps";
  return null;
}

/**
 * The trace must record what the tool really returned, not the stand-in the
 * model saw — the run page is where someone debugs a bad digest, and a
 * descriptor tells them nothing.
 */
export function resolveForTrace(output: unknown, store: ResultStore): unknown {
  if (!isDescriptor(output)) return output;
  const found = store.get(output.handle);
  return found.ok ? found.payload : output;
}

export function wrapToolsWithHandles(
  tools: ToolSet,
  options: { workflowId: string; store: ResultStore; state: HarnessState },
): ToolSet {
  if (!handlesEnabled()) return tools;

  const { workflowId, store, state } = options;
  // Counts every local call, including one that found no handle or failed its
  // query. Deliberate: a model looping on a bad handle burns the same model
  // round trips as a model reading real data, and the budget exists to bound
  // round trips, not successes.
  let queriesUsed = 0;

  /** Every system tool shares this gate, and each counts as a degraded read. */
  function budgetSpent(): { error: string } | null {
    if (queriesUsed < MAX_QUERIES_PER_RUN) {
      queriesUsed++;
      return null;
    }
    state.degradedReads++;
    return {
      error:
        "query budget exhausted — write the digest from what you have, and say in it that some data could not be read",
    };
  }

  const wrapped: ToolSet = {};

  for (const [name, definition] of Object.entries(tools)) {
    const original = definition.execute;
    if (!original) {
      wrapped[name] = definition;
      continue;
    }

    wrapped[name] = {
      ...definition,
      execute: async (args: unknown, context: unknown) => {
        const result = await (
          original as (a: unknown, c: unknown) => Promise<unknown>
        )(args, context);

        if (isFailure(result)) return result;

        let json: string;
        try {
          json = JSON.stringify(result) ?? "";
        } catch {
          // Unserialisable, so it cannot be stored or hashed. Hand it back
          // untouched rather than failing the call over it.
          return result;
        }

        if (json.length < HANDLE_THRESHOLD_CHARS) return result;

        // argsHash goes through canonicalHash so key order in the call
        // doesn't defeat the "unchanged" check; resultHash hashes the exact
        // JSON bytes already computed above, since it's compared byte-for-byte
        // against a hash of the previous run's exact JSON, not re-serialised.
        const argsHash = canonicalHash(args);
        const resultHash = createHash("sha256").update(json).digest("hex");
        const previous = await readToolHash(workflowId, name, argsHash);

        const descriptor = store.put(name, result, json);
        if (previous?.resultHash === resultHash) {
          descriptor.unchanged_since = previous.seenAt.toISOString();
        }

        // Buffered, not written: the run has to earn it. Also keeps a
        // database round trip off the tool-call path.
        state.pendingHashes.push({ toolSlug: name, argsHash, resultHash });
        return descriptor;
      },
    } as ToolSet[string];
  }

  Object.assign(
    wrapped,
    buildSystemTools({
      store,
      budgetSpent,
      markDegraded: () => {
        state.degradedReads++;
      },
    }),
  );

  return wrapped;
}
