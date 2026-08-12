import { createHash } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  canonicalHash,
  readToolHash,
  writeToolHash,
} from "@/lib/data/tool-hashes";
import { isFailure } from "@/lib/connection-gate";
import { runQuery, type QuerySpec } from "./query";
import { describeShape, sampleOf } from "./shape";
import { isDescriptor, type ResultStore } from "./result-store";

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
 */

export const HANDLE_THRESHOLD_CHARS = 2_000;
export const MAX_QUERIES_PER_RUN = 15;
export const LOCAL_TOOL_NAMES = ["query", "inspect"] as const;

/** How much of a long text value one `query` call returns. */
export const MAX_STRING_SLICE_CHARS = 1_500;

export function handlesEnabled(): boolean {
  return process.env.HANDLES_ENABLED !== "false";
}

export type PendingHash = {
  toolSlug: string;
  argsHash: string;
  resultHash: string;
};

/**
 * What the wrapper learned during a run that only the executor can act on.
 *
 * Owned by the caller rather than returned, so the wrapper's public shape
 * stays "a ToolSet in, a ToolSet out" and the executor can read this after
 * the loop has finished — including on the paths where it never finished.
 */
export type HarnessState = {
  /**
   * Hashes for calls made this run, held until the run's verdict is known.
   *
   * Writing one inline would be a lie waiting to happen: if the run then dies
   * — auth rejected, timeout, step cap — the hash says "the workflow has seen
   * these bytes" while no digest ever carried them. The next run fetches the
   * same bytes, is told `unchanged_since`, reports nothing new, and the
   * content is lost for good. Only a run that reached a delivered digest has
   * earned the right to claim it saw the data.
   */
  pendingHashes: PendingHash[];
  /**
   * Reads the model asked for and did not get — a spent query budget or an
   * evicted handle. Both are returned to the model as ordinary error values,
   * so without a counter here the run looks identical to one that read
   * everything it wanted, and gets recorded as a clean `ok`.
   */
  degradedReads: number;
};

export function createHarnessState(): HarnessState {
  return { pendingHashes: [], degradedReads: 0 };
}

/**
 * Commits the run's hashes. Call only where the run is recorded as a clean
 * `ok` — see `HarnessState.pendingHashes` for why anywhere else is a bug.
 */
export async function flushToolHashes(
  workflowId: string,
  state: HarnessState,
): Promise<void> {
  const pending = state.pendingHashes.splice(0);
  await Promise.all(
    pending.map((hash) =>
      writeToolHash(workflowId, hash.toolSlug, hash.argsHash, hash.resultHash),
    ),
  );
}

/** Steps that spent the workflow's budget: the ones that called a real tool. */
export function countExternalSteps(
  steps: Array<{ toolCalls?: Array<{ toolName: string }> }>,
): number {
  const local = new Set<string>(LOCAL_TOOL_NAMES);
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

  /** Both local tools share this gate, and both count as a degraded read. */
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

  const whereSchema = z.object({
    field: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    contains: z.string().optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  });

  wrapped.query = tool({
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
          "Where to start when the value is a long text — use it with the `offset`/`total` in the reply to read the next part.",
        ),
    }),
    execute: async ({ handle, offset = 0, ...spec }) => {
      const spent = budgetSpent();
      if (spent) return spent;

      const found = store.get(handle);
      if (!found.ok) {
        if (found.evicted) state.degradedReads++;
        return { error: found.error };
      }

      const outcome = runQuery(found.payload, spec as QuerySpec);
      if (!outcome.ok) {
        return { error: outcome.error, shape_at_path: outcome.shapeAtPath };
      }

      const value = outcome.value;

      /*
       * A long text is the one thing that must never come back as a handle.
       * There is no narrowing operation for a string — `path` cannot go into
       * it and `take` only applies to arrays — so re-handling one puts the
       * agent in a loop that spends its whole budget and never yields a
       * character of the article it was told to fetch. A bounded slice with
       * its own offset is the only answer that terminates.
       */
      if (typeof value === "string") {
        // Raw length, not a JSON.stringify of the whole string just to measure
        // it — quoting/escaping only ever adds a few chars, well inside the
        // slack this threshold already has.
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

      // Other scalars are small by construction and are handed back whole —
      // only a container can be narrowed further, so only a container is
      // worth re-handling.
      if (value === null || typeof value !== "object") return { value };

      // A narrowing that is still huge gets the same treatment as a tool
      // result, so the agent can narrow again rather than blowing the budget.
      const json = JSON.stringify(value) ?? "";
      if (json.length >= HANDLE_THRESHOLD_CHARS) {
        return store.put(`query(${handle})`, value, json);
      }
      return { value };
    },
  });

  wrapped.inspect = tool({
    description:
      "Show the structure and a short sample of a stored tool result, without returning its rows. Does not spend your step budget.",
    inputSchema: z.object({
      handle: z.string(),
      path: z.string().optional(),
    }),
    execute: async ({ handle, path }) => {
      const spent = budgetSpent();
      if (spent) return spent;

      const found = store.get(handle);
      if (!found.ok) {
        if (found.evicted) state.degradedReads++;
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

  return wrapped;
}

/** Appended to the system prompt, and static so it is the same text every run. */
export const HANDLE_PROMPT = `Most tool results come back to you in full, as ordinary values — use them
directly. Only a LARGE result is replaced by a descriptor: an object with a
"handle" field like "r1", plus the payload's shape, its size, a short sample,
and usually "preview_rows" — the first few entries of its main list, in full.
If preview_rows already answers the goal, write the digest from it.

A handle exists only if you were given one in a descriptor you can see in this
conversation. Never guess or invent a handle: if the result you want to read
came back in full, it is already in front of you, and calling query on a made-up
handle wastes the run. When a descriptor is present, the full payload is held
for this run and you read it with two tools:

- query({handle, path, pick, where, sort, take, count, offset}) — returns only
  the fields and rows you ask for. \`where\` supports equals, contains, after,
  before. A long text comes back in slices: re-call with \`offset\` while the
  reply says "truncated": true.
- inspect({handle, path}) — returns shape and a sample only, for when you need
  the field names before you can pick them.

Neither makes an external call, and neither spends your step budget. Each one
is still a round trip that re-sends this conversation, so plan them: one or two
per handle, aimed at what the goal needs, rather than exploring.

If a descriptor carries "unchanged_since", the tool ran this run and returned
data byte-identical to the previous run's. That is live evidence of no change —
report it as unchanged and do not query it again to confirm.`;
