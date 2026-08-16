import { generateText, type ToolSet } from "ai";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";
import { getToolsFor } from "@/lib/composio";
import { runCostUsd, toCostColumn } from "@/lib/run-cost";
import { MissingProviderKeyError, resolveModelForUser } from "@/lib/provider";
import { redactSecrets } from "@/lib/crypto/secrets";
import {
  checkConnections,
  isAuthError,
  isFailure,
  requiredToolkits,
  toolkitForSlug,
} from "@/lib/connection-gate";
import { markConnectionStatus } from "@/lib/data/connections";
import { LIMITS } from "@/lib/limits";
import {
  buildToolFilter,
  deliverInstruction,
  deliverToolkits,
  DELIVER_TOOL_SLUGS,
  type DeliverTarget,
} from "@/lib/read-only";
import { createResultStore } from "@/lib/agent/result-store";
import {
  createHarnessState,
  flushToolHashes,
  handlesEnabled,
  loopBoundHit,
  resolveForTrace,
  runLoopExhausted,
  wrapToolsWithHandles,
  HANDLE_PROMPT,
  type HarnessState,
} from "@/lib/agent/wrap-tools";
import { systemCacheOptions } from "@/lib/agent/prompt-cache";
import { HISTORY_PROMPT, REPORT_PROMPT } from "@/lib/agent/system-tools";
import { parseSignalSchema, type Envelope } from "@/lib/outcome/envelope";
import type { SignalDecl } from "@/lib/outcome/condition";
import { decideChildren, decideDelivery } from "@/lib/outcome/route";
import { checkCostCap, type CapVerdict } from "@/lib/cost-cap";

type Workflow = typeof workflows.$inferSelect;

/**
 * Hard ceiling on one run's model+tool loop. Deliberately under the route's
 * `maxDuration` (300s) so a stuck tool call fails as a recorded error, with
 * time left to write it, instead of the function being killed mid-run.
 */
export const RUN_TIMEOUT_MS = 240_000;

/** Tool results are stored for the trace, not as a data lake. */
const MAX_STEP_RESULT_CHARS = 8_000;

/** How much of the previous digest is worth re-reading for context. */
const MEMORY_CHARS = 4_000;

/**
 * History lookups one run may make.
 *
 * Small on purpose: history is context for the work, not the work. Each call
 * also re-sends the conversation, so an unbounded budget is a token bill, not
 * a better digest.
 */
const HISTORY_BUDGET = 5;

/** The agent's exact reply when nothing happened since the last digest. */
export const NO_UPDATES = "NO_UPDATES";

/**
 * Deliberately static per workflow — every per-run fact (current time,
 * previous digest, event payload) lives in the user prompt instead.
 *
 * That keeps the prompt identical across a run's steps, which is what makes
 * it cacheable: a `cache_control` breakpoint on the system message covers the
 * tool schemas and this prompt in one prefix (see
 * `src/lib/agent/prompt-cache.ts`). A per-run fact in here would silently
 * cost that discount every step.
 */
function systemPrompt(workflow: Workflow): string {
  const cadence = workflow.cron
    ? `It runs on the cron schedule "${workflow.cron}" (${workflow.timezone}), so "since the last run" means roughly one such interval.`
    : `It runs whenever a matching event fires, so runs may be minutes or days apart — judge recency from the timestamps in the prompt, not from an assumed schedule.`;

  return `You are a personal automation agent running "${workflow.name}", an unattended,
scheduled workflow. ${cadence}

The current date and time appears at the top of the user message. Treat it as
ground truth for "today"/"latest"/"current" — never answer from your own training
data for anything that changes over time (prices, scores, GMP, news, schedules,
statuses). If a fact could plausibly be different today than when you were
trained, you MUST fetch it fresh with a tool this run; do not state it from memory.

Nobody is watching this run. There is no one to ask, so when the goal is
ambiguous, take the narrowest reading that is still useful and note the
assumption in one line at the end of the digest.

You have a hard budget of ${workflow.maxSteps} steps for this run, and every
tool call spends one. Budget them: fetch what the goal depends on first, and
leave room for any delivery tool call you were asked to make — a run that hits
the cap mid-task is recorded as truncated, which is worse than a digest built
from one fetch fewer.

Rules:
- You are READ-ONLY. Only the tools you've been given exist for you — there is
  no other way to take action, so never claim to have sent, created, or
  changed anything unless you actually called a tool that did it.
- If the goal or trigger payload contains a URL, you MUST call a fetch/search
  tool against it this run to get its current content — never describe or
  summarize a URL's contents from memory, and never reuse a stale value from
  your previous digest when a live source is available to check it.
- Work in the fewest tool calls that answer the goal, but "fewest" never means
  skipping the fetch a time-sensitive claim needs. Fetch what the goal
  actually depends on, then stop — do not keep browsing for completeness once
  you can write the digest.
- Be concise. Your final answer is a short markdown digest a human will
  skim on a phone: headline first, then a tight bulleted list. No preamble,
  no "here is a summary of...".
- If a tool call fails or returns nothing, say so plainly in one line rather
  than guessing or inventing content.
- If you are shown a previous digest, treat its numbers/facts as stale by
  default — re-check them against a live source rather than repeating them,
  and report only what changed since it. Do not repeat items it already
  covered.
- If nothing has changed since the previous digest, say so with
  report({no_updates: true}) and do not call any delivery tool. Silence is
  better than a digest that says "no updates" in ten words.${handlesEnabled() ? `\n\n${HANDLE_PROMPT}` : ""}

${REPORT_PROMPT}

${HISTORY_PROMPT}`;
}

type EnqueueResult =
  | { runId: string; skipped?: false }
  | {
      runId: null;
      skipped: true;
      reason: string;
      /** Human-readable, for the caller to render. */
      message?: string;
      /** Where the user can go to fix it, when there is somewhere. */
      action?: { label: string; href: string };
    };

/**
 * Per-user run quotas.
 *
 * Not atomic — it counts then inserts, so two simultaneous requests can both
 * squeeze past. Acceptable: the dangerous duplicate (two runs of the *same*
 * workflow) is prevented by a database index, and these ceilings exist to
 * stop sustained abuse, not to be exact to the unit. An atomic version costs
 * an advisory lock per run for no practical gain.
 */
async function runQuotaExceeded(
  workflowId: string,
): Promise<{ reason: string; message: string } | null> {
  const [owner] = await db
    .select({ userId: workflows.userId })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  const userId = owner?.userId;
  if (!userId) return null;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${runs.status} in ('queued','running'))::int`,
      lastHour: sql<number>`count(*) filter (where ${runs.createdAt} > ${hourAgo})::int`,
      lastDay: sql<number>`count(*) filter (where ${runs.createdAt} > ${dayAgo})::int`,
    })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(eq(workflows.userId, userId));

  if ((counts?.active ?? 0) >= LIMITS.maxConcurrentRuns) {
    return {
      reason: "concurrency_limit",
      message: `You already have ${LIMITS.maxConcurrentRuns} runs in flight. Wait for one to finish.`,
    };
  }
  if ((counts?.lastHour ?? 0) >= LIMITS.maxRunsPerHour) {
    return {
      reason: "rate_limit",
      message: `That's ${LIMITS.maxRunsPerHour} runs in the last hour — the hourly limit.`,
    };
  }
  if ((counts?.lastDay ?? 0) >= LIMITS.maxRunsPerDay) {
    return {
      reason: "rate_limit",
      message: `That's ${LIMITS.maxRunsPerDay} runs today — the daily limit.`,
    };
  }
  return null;
}

/**
 * Claims a run slot. The `runs_one_active_per_workflow` partial unique index
 * actually prevents a double execution when a cron tick and a "Run now"
 * click land together — this just turns the constraint violation into an
 * ordinary "skipped" answer.
 */
export async function enqueueRun(
  workflowId: string,
  trigger: "cron" | "manual" | "event" | "workflow",
  options: {
    triggerRef?: string;
    triggerPayload?: unknown;
    parentRunId?: string;
  } = {},
): Promise<EnqueueResult> {
  const overQuota = await runQuotaExceeded(workflowId);
  if (overQuota) {
    return { runId: null, skipped: true, ...overQuota };
  }

  try {
    const [run] = await db
      .insert(runs)
      .values({
        workflowId,
        trigger,
        status: "queued",
        triggerRef: options.triggerRef ?? null,
        triggerPayload: (options.triggerPayload as object) ?? null,
        parentRunId: options.parentRunId ?? null,
      })
      .returning({ id: runs.id });

    // Stamped on the attempt, not success — else a workflow erroring every
    // time would stay "due" and re-fire every tick.
    await db
      .update(workflows)
      .set({ lastAttemptAt: new Date() })
      .where(eq(workflows.id, workflowId));

    return { runId: run.id };
  } catch (err) {
    const violated = violatedConstraint(err);
    if (violated === "runs_one_active_per_workflow") {
      return { runId: null, skipped: true, reason: "already_running" };
    }
    if (violated === "runs_trigger_ref_unique") {
      return { runId: null, skipped: true, reason: "duplicate_event" };
    }
    throw err;
  }
}

const RUN_CONSTRAINTS = [
  "runs_one_active_per_workflow",
  "runs_trigger_ref_unique",
] as const;

/**
 * Drizzle wraps driver errors ("Failed query: insert into …") and hangs the
 * real one off `cause`, so the constraint name is never on the outermost
 * message — walk the chain for it.
 */
function violatedConstraint(err: unknown): string | null {
  for (let current = err, depth = 0; current && depth < 5; depth++) {
    const candidate = current as {
      constraint?: string;
      message?: string;
      cause?: unknown;
    };
    if (candidate.constraint) return candidate.constraint;
    const match = RUN_CONSTRAINTS.find((name) =>
      candidate.message?.includes(name),
    );
    if (match) return match;
    current = candidate.cause;
  }
  return null;
}

export type RunResult =
  | { runId: string; status: "ok" | "truncated" }
  | { runId: string; status: "error"; error: string }
  | { runId: string; status: "skipped"; reason: string };

/** Enqueue + execute, for callers that want to block until it's done. */
export async function runWorkflow(
  workflow: Workflow,
  trigger: "cron" | "manual" | "event",
): Promise<RunResult> {
  const queued = await enqueueRun(workflow.id, trigger);
  if (queued.skipped) {
    return { runId: "", status: "skipped", reason: queued.reason };
  }
  return executeRun(queued.runId);
}

/**
 * Executes a queued run. Safe to call from `after()` — every outcome,
 * including a crash, is written back to the run row.
 */
export async function executeRun(runId: string): Promise<RunResult> {
  // A conditional update: only the caller that flips the row out of
  // `queued` gets to run it.
  const [run] = await db
    .update(runs)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.status, "queued")))
    .returning();

  if (!run) return { runId, status: "skipped", reason: "not_queued" };

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, run.workflowId));

  if (!workflow) {
    await failRun(runId, Date.now(), "workflow no longer exists");
    return { runId, status: "error", error: "workflow no longer exists" };
  }

  const startedAt = Date.now();
  let stepIdx = 0;

  const recordStep = async (
    row: Omit<
      typeof runSteps.$inferInsert,
      "id" | "runId" | "idx" | "createdAt"
    >,
  ) => {
    await db.insert(runSteps).values({ runId, idx: stepIdx++, ...row });
  };

  if (!workflow.userId) {
    await failRun(runId, Date.now(), "workflow has no owner");
    return { runId, status: "error", error: "workflow has no owner" };
  }
  const ownerId = workflow.userId;

  try {
    /*
     * Cost cap, before anything that costs money.
     *
     * Wrapped because the cap is a guardrail, not a correctness gate: if the
     * spend query fails, better to run the workflow and lose the cap for one
     * tick than stop someone's scheduled work over a database hiccup.
     */
    let cap: CapVerdict = { state: "uncapped", spent: 0, cap: null };
    try {
      cap = await checkCostCap(workflow);
    } catch (err) {
      console.error(`[cost] ${workflow.slug} cap check failed`, err);
    }

    if (cap.state === "over") {
      const message = `monthly cost cap reached — $${cap.spent.toFixed(2)} spent against a $${cap.cap?.toFixed(2)} cap`;

      // Paused rather than left to fail every tick. `pausedReason` also lets
      // raising the cap re-enable exactly the workflows it stopped.
      await db
        .update(workflows)
        .set({ enabled: false, pausedReason: "cost_cap" })
        .where(eq(workflows.id, workflow.id));

      await failRun(runId, startedAt, message, { errorCode: "cost_cap" });
      return { runId, status: "error", error: message };
    }

    const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
    const toolkits = [
      ...new Set([...workflow.toolkits, ...deliverToolkits(deliver)]),
    ];

    /*
     * Preflight. Cheaper than discovering the same thing one failed tool call
     * at a time, and it produces an honest verdict — a run that can't reach
     * its apps used to end as `ok` with a digest apologising for it.
     */
    const required = await requiredToolkits(workflow);
    const gate = await checkConnections(ownerId, required);
    if (!gate.ok) {
      const message = `Run blocked: ${gate.reason}. Reconnect and it will run again.`;
      await failRun(runId, startedAt, message, {
        errorCode: "needs_reconnect",
        errorToolkits: gate.blocked,
      });
      await noteConnectionFailure(workflow.id);
      return { runId, status: "error", error: message };
    }

    const allTools = await getToolsFor(ownerId, toolkits);

    const isAllowed = buildToolFilter(
      deliver,
      workflow.allowTools,
      workflow.denyTools,
      workflow.readOnly,
    );
    const tools: ToolSet = Object.fromEntries(
      Object.entries(allTools).filter(([slug]) => isAllowed(slug)),
    );
    const store = createResultStore();
    const harness = createHarnessState();

    const declaredSignals = parseSignalSchema(workflow.signalSchema);
    /*
     * The run's outcome, deposited by the `report` tool.
     *
     * A slot the executor owns rather than a return value, because the agent
     * loop swallows tool results — the envelope must outlive the loop for the
     * run to have an outcome at all, even when the loop ended badly.
     */
    let envelope: Envelope | null = null;

    const runTools = wrapToolsWithHandles(tools, {
      workflowId: workflow.id,
      store,
      state: harness,
      signals: declaredSignals,
      setEnvelope: (next) => {
        // Last call wins — the tool says "exactly once", but a model
        // correcting itself after a validation error shouldn't be punished.
        envelope = next;
      },
      ownerId,
      historyBudgetSpent: () => {
        if (harness.historyCalls >= HISTORY_BUDGET) {
          return {
            error: `history budget spent (${HISTORY_BUDGET} calls) — work with what you have`,
          };
        }
        harness.historyCalls++;
        return null;
      },
    });

    const deliverInstructions = deliver
      .map(deliverInstruction)
      .filter(Boolean)
      .join("\n");

    const [previous, failure] = await Promise.all([
      previousDigest(workflow.id),
      previousFailure(workflow.id),
    ]);
    const now = new Date();
    const system = systemPrompt(workflow);

    // Toolkits whose credentials the provider rejected mid-run. Collected
    // during the loop, acted on after: a run can't be un-started, but it can
    // be recorded truthfully.
    const authFailed = new Set<string>();

    const cacheOptions = systemCacheOptions();

    const result = await generateText({
      model: await resolveModelForUser(ownerId, workflow.model),
      // The system prompt travels as a message rather than the `system`
      // option because a message can carry provider options, and that's
      // where the cache breakpoint goes. The text is unchanged either way.
      messages: [
        {
          role: "system" as const,
          content: deliverInstructions
            ? `${system}\n\n${deliverInstructions}`
            : system,
          ...(cacheOptions ? { providerOptions: cacheOptions } : {}),
        },
        {
          role: "user" as const,
          content: buildPrompt(
            workflow,
            previous,
            failure,
            run.triggerPayload,
            now,
          ),
        },
      ],
      allowSystemInMessages: true,
      tools: runTools,
      // `maxSteps` is the workflow's budget for *real* tool calls — what the
      // system prompt tells the agent it has. `query`/`inspect` read data
      // already fetched, so they don't spend it. See `runLoopExhausted` for
      // why an absolute bound is also needed.
      stopWhen: ({ steps }) => runLoopExhausted(steps, workflow.maxSteps),
      abortSignal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      onStepFinish: async (step) => {
        /*
         * Both lists, not just `toolResults`.
         *
         * Composio's tools arrive through `wrapToolsForProvider` as *dynamic*
         * tools, so the SDK files their results under `dynamicToolResults`;
         * `toolResults` carries only the statically-typed ones (`query`,
         * `inspect`). Reading just the latter made every Composio result look
         * like `undefined` — the trace recorded `null` for the calls worth
         * tracing, and the `successful === false` check below could never
         * fire: the dead-connection-looks-green bug noted further down.
         */
        const stepResults = [
          ...(step.toolResults ?? []),
          ...(step.dynamicToolResults ?? []),
        ];

        for (const call of step.toolCalls ?? []) {
          const matchingResult = stepResults.find(
            (r) => r.toolCallId === call.toolCallId,
          );

          // Composio reports failures in the result body rather than throwing,
          // so a rejected credential arrives here as an ordinary value.
          //
          // A descriptor stands in for the payload in the model's context, but
          // not here — the auth check and the trace both need the actual
          // tool output.
          const output = resolveForTrace(matchingResult?.output, store) as
            { successful?: boolean; error?: string | null } | undefined;
          const failed = isFailure(output);

          if (failed && isAuthError(output?.error)) {
            const toolkit = toolkitForSlug(call.toolName, toolkits);
            if (toolkit) authFailed.add(toolkit);
          }

          await recordStep({
            type: "tool",
            toolSlug: call.toolName,
            argsJson: call.input as object,
            resultJson: truncateForTrace(output),
            // Previously recorded with `error: null` always, so a trace
            // showed a failed call as an ordinary one.
            error: failed ? (output?.error ?? "tool call failed") : null,
          });
        }
        if (step.text) {
          await recordStep({ type: "text", resultJson: { text: step.text } });
        }
      },
    });

    /*
     * Where the run's outcome comes from.
     *
     * `report` is the protocol, but some workflows predate it and some models
     * occasionally end a turn without calling it. Falling back to the final
     * text keeps those runs working as before.
     *
     * The fallback is only safe when the workflow asks nothing of the
     * envelope. One that declares signals or an alert condition can't be
     * routed without a report — delivering anyway would silently skip every
     * threshold configured — so that case is an error.
     */
    const needsEnvelope =
      declaredSignals.length > 0 || Boolean(workflow.alertCondition?.trim());

    const reported: Envelope | null = envelope;
    let outcome: Envelope;

    if (reported) {
      outcome = reported;
    } else {
      const text = result.text.trim();
      if (needsEnvelope) {
        await db.insert(outputs).values({
          runId,
          format: "markdown",
          body: text,
          unchanged: false,
          deliveredTo: [],
          deliveryLog: [],
          // Nothing was attempted; left to its default this row would claim
          // "delivered" — the exact lie deliveryStatus exists to end.
          deliveryStatus: "skipped",
        });
        const message =
          "the run never called report, so its signals and alert condition could not be evaluated";
        await failRun(runId, startedAt, message, { errorCode: "no_report" });
        return { runId, status: "error", error: message };
      }
      outcome = {
        digest: text === NO_UPDATES ? "" : text,
        signals: {},
        severity: null,
        noUpdates: text === NO_UPDATES,
      };
    }

    // Kept so paths below that only ever needed the text, including the
    // NO_UPDATES sentinel they compare against, still read the same way.
    const body = outcome.noUpdates ? NO_UPDATES : outcome.digest;

    /*
     * The run got past preflight but a credential was rejected while it ran —
     * the token expired between the check and the call, or Composio's status
     * hadn't caught up.
     *
     * This used to be recorded as a success: the agent reports tool failures
     * in one line, so the run ended `ok` with a digest saying it couldn't
     * read Slack, and the dashboard showed green. The digest is still saved
     * as a trace, but the run is now an error and the connection is marked so
     * the next run is blocked at the gate instead.
     */
    if (authFailed.size > 0) {
      const blocked = [...authFailed];
      for (const toolkit of blocked) {
        await markConnectionStatus(
          ownerId,
          toolkit,
          "expired",
          "a tool call was rejected: authorisation failed",
        );
      }

      await db.insert(outputs).values({
        runId,
        format: "markdown",
        body,
        unchanged: true,
        deliveredTo: [],
        deliveryLog: [],
        deliveryStatus: "skipped",
      });

      const message = `Authorisation failed for ${blocked.join(", ")} during the run — reconnect it.`;
      await failRun(runId, startedAt, message, {
        errorCode: "needs_reconnect",
        errorToolkits: blocked,
      });
      await noteConnectionFailure(workflow.id);
      return { runId, status: "error", error: message };
    }

    const degraded = harness.degradedReads > 0;

    /*
     * FINDING 2: an explicit NO_UPDATES is the agent doing its job — it
     * looked and found nothing worth reporting. An empty string isn't that:
     * the model produced no answer at all, for an unknown reason. The old
     * check (`body === NO_UPDATES || body === ""`) treated the two the same,
     * recording an empty reply as an ordinary quiet `ok` — flushing hashes
     * and leaving nothing to show what happened. There's no digest to be
     * honest about, so this is an `error`, not `truncated`: that name is for
     * a bound the system understands (step cap, read budget), which an empty
     * reply doesn't have. Its own `empty_response` code — not
     * `degraded_reads` — also keeps it out of FINDING 1's read-budget advice
     * below, the wrong lesson for a run that may not have had a read problem.
     */
    if (!outcome.noUpdates && outcome.digest === "") {
      await db.insert(outputs).values({
        runId,
        format: "markdown",
        body: "",
        unchanged: false,
        deliveredTo: [],
        deliveryLog: [],
        deliveryStatus: "skipped",
      });

      const message = degraded
        ? `the model returned no text this run, and some fetched data could not be read (${harness.degradedReads} read${harness.degradedReads === 1 ? "" : "s"} unavailable) — nothing to report or deliver`
        : "the model returned no text this run — nothing to report or deliver";

      await failRun(runId, startedAt, message, { errorCode: "empty_response" });
      return { runId, status: "error", error: message };
    }

    const unchanged = outcome.noUpdates;

    /*
     * The agent asked for data it could not get — a spent query budget or an
     * evicted handle. It's told to say so, but an unattended run can't rely
     * on that; nobody's reading. A clean `ok` run can't carry this in
     * `runs.error` (the run page renders any error there as "Run failed"),
     * so it goes into the digest itself; a run already ending badly carries
     * it in its error text.
     */

    /*
     * A degraded run that also produced nothing (`unchanged`) is
     * indistinguishable, downstream, from an ordinary quiet morning: no note
     * in the digest, `runs.error` stays null, status is `ok`, delivery is
     * skipped as "nothing new to send". That's the exact failure this finding
     * names — a run that couldn't read its data, recorded as a clean morning
     * with no trace anywhere. `truncated` is the honest bucket for "this run
     * didn't see everything it fetched", rendered as "Run cut short", not
     * "Run failed".
     */
    const degradedBlind = degraded && unchanged;

    // The model ran out of steps mid-task: the digest is a fragment, and
    // saying "ok" would be a lie. A degraded-and-blind run earns the same
    // verdict, even though it stopped on its own terms rather than hitting
    // the step cap.
    const truncation = truncationReason(result, workflow);
    const truncated = truncation !== null || degradedBlind;

    /*
     * MINOR 5 (revised): a step-cap truncation and a degraded read can
     * collide, and the note has two possible homes — the digest, and
     * `runs.error`. The digest wins whenever there is one: it's the artefact
     * a human actually receives, while `runs.error` is a dashboard column
     * nobody watches at 6am. Filing the disclosure only there, for a run that
     * did ship a digest, hides it from the one place someone would see it.
     * So every degraded run with a digest (`!unchanged`) gets the note in the
     * body — truncated or not. Only degraded-BLIND (no digest at all) has
     * nowhere else, so `runs.error` stays its sole home.
     */
    const digest =
      degraded && !unchanged ? `${body}\n\n${degradedNote(harness)}` : body;

    // The alert condition decides whether this digest is worth waking
    // someone for. An unevaluable condition still delivers — see
    // `decideDelivery` for why silence is the dangerous answer there.
    const decision = decideDelivery(
      outcome,
      workflow.alertCondition,
      declaredSignals,
    );

    const deliveryLog = decision.deliver
      ? await deliverOutput({
          workflow,
          deliver,
          body: digest,
          unchanged,
          calledTools: result.toolCalls.map((c) => c.toolName),
        })
      : [];

    await db.insert(outputs).values({
      runId,
      format: "markdown",
      body: digest,
      unchanged,
      signals: outcome.signals,
      severity: outcome.severity,
      suppressed: decision.suppressed,
      suppressedReason: decision.suppressedReason,
      deliveredTo: deliveryLog.filter((d) => d.ok).map((d) => d.type),
      deliveryLog,
      deliveryStatus: deliveryStatusFrom(deliveryLog, decision.deliver),
      deliveryAttempts: decision.deliver ? 1 : 0,
    });

    const usage = result.usage as
      | {
          inputTokens?: number;
          outputTokens?: number;
          cachedInputTokens?: number;
        }
      | undefined;

    await db
      .update(runs)
      .set({
        // Delivery outcome is recorded on the output, not here — see
        // `deliveryStatusFrom`. The agent did its job either way, which is
        // what this status is about.
        status: truncated ? "truncated" : "ok",
        finishReason: result.finishReason ?? null,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        costUsd: toCostColumn(await runCostUsd(workflow.model, usage, ownerId)),
        // The note now lives in the digest for any degraded run that
        // produced one (see `digest` above) — `runs.error` only carries it
        // for the degraded-BLIND case, which has no digest. A
        // truncated-but-not-blind run's error is just the truncation reason;
        // duplicating the note here would repeat the same sentence twice.
        error: degradedBlind
          ? truncation
            ? `${truncation} ${degradedNote(harness, "plain")}`
            : degradedNote(harness, "plain")
          : truncation,
        // FINDING 1 (revised): `degraded_reads` now marks *every* degraded
        // run, not only blind ones — including a `total-steps` truncation,
        // which by definition already spent the read budget. Restricting
        // this to `degradedBlind` left `total-steps` with `errorCode: null`,
        // so `previousFailure`/`buildPrompt` took the step-cap branch and
        // told the next run to fetch less — wrong when the fault was
        // reading, not fetching. `previousFailure` already ignores
        // `ok`-status rows, so tagging a degraded-but-not-truncated `ok` run
        // here is inert downstream.
        errorCode: degraded ? "degraded_reads" : null,
      })
      .where(eq(runs.id, runId));

    // Only a completed run counts as "last ran" for display purposes.
    if (!truncated) {
      /*
       * The one place a hash may be committed: the run finished, produced a
       * digest, delivered it, and every target that was actually attempted
       * received it. A hash written anywhere else claims the workflow has
       * seen bytes that never reached a reader, and the next run would then
       * skip them as `unchanged_since`. A degraded run has the same problem
       * — the model never read part of what it fetched — so it does not get
       * to record the hashes either. `skipped` entries ("nothing new to
       * send") are the design working, not a failed delivery, so they don't
       * block the flush — only an attempted-and-failed target does.
       *
       * A suppressed digest is a third case: an empty `deliveryLog` must not
       * read as success there — a threshold withheld it, so no reader saw
       * those bytes. Recording the hashes would mark a later, over-threshold
       * value as unchanged. `unchanged` runs differ — they had nothing to
       * deliver, which is why they still flush.
       */
      const deliveryOk =
        !decision.suppressed && !deliveryLog.some((d) => !d.ok && !d.skipped);
      if (!degraded && deliveryOk) {
        try {
          await flushToolHashes(workflow.id, harness);
        } catch {
          // `writeToolHash` already swallows its own errors, so this should
          // be unreachable — but the run row is already committed as a
          // successful, delivered `ok`, and a flush failure escaping to the
          // outer `catch` would overwrite that verdict with `error` and skip
          // the reset below. Defence in depth: a hash-table hiccup must not
          // relabel a run that genuinely finished and delivered.
        }
      }

      await db
        .update(workflows)
        // A run that reached its apps clears the connection-failure streak —
        // else one bad afternoon would eventually pause an otherwise healthy
        // workflow.
        .set({ lastRunAt: new Date(), connectionFailures: 0 })
        .where(eq(workflows.id, workflow.id));

      // Chained children fire only from a run that finished. A truncated run
      // produced a fragment, and handing it downstream would spend a model
      // call per child on a premise the parent doesn't stand behind.
      await enqueueChildRuns(runId, workflow, outcome, declaredSignals);
    } else if (degradedBlind) {
      /*
       * MINOR 4: a degraded-blind run still reached its apps — preflight
       * passed and every tool call succeeded, only the *local* reads ran
       * out. Leaving `connectionFailures` untouched would eventually
       * auto-pause a workflow whose connections are fine, over a run-loop
       * budget problem unrelated to them. `lastRunAt` is left alone: it
       * means "the last time this workflow completed with output", which a
       * degraded-blind run — by definition — didn't.
       */
      await db
        .update(workflows)
        .set({ connectionFailures: 0 })
        .where(eq(workflows.id, workflow.id));
    }

    return { runId, status: truncated ? "truncated" : "ok" };
  } catch (err) {
    const raw =
      err instanceof Error
        ? err.name === "TimeoutError" || err.name === "AbortError"
          ? `run exceeded ${RUN_TIMEOUT_MS / 1000}s and was aborted`
          : err.message
        : String(err);

    // This string is rendered on the run page. Provider SDK errors quote the
    // request they failed on, which can include the API key.
    const message = redactSecrets(raw);

    // A missing key is a state, not a fault — the message already says what to
    // do, and the code lets the UI link there.
    const errorCode =
      err instanceof MissingProviderKeyError
        ? "missing_provider_key"
        : isAuthError(raw)
          ? "needs_reconnect"
          : null;

    await failRun(runId, startedAt, message, errorCode ? { errorCode } : {});
    return { runId, status: "error", error: message };
  }
}

/**
 * Inserts a queued run for every child whose gate the parent's signals opened.
 *
 * Queued rather than executed inline: the tick has one function duration
 * split across every due workflow, and running a chain here spends another
 * user's slice of it. The row is durable, so a crash between this insert and
 * the drain pass costs a delay, not the run.
 *
 * Failures are logged and swallowed. A parent that delivered its digest has
 * succeeded; a child that couldn't be enqueued must not retroactively turn
 * that run red.
 */
export async function enqueueChildRuns(
  parentRunId: string,
  workflow: Workflow,
  envelope: Envelope,
  declaredSignals: SignalDecl[],
): Promise<void> {
  try {
    const children = await db
      .select({
        id: workflows.id,
        parentCondition: workflows.parentCondition,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.parentWorkflowId, workflow.id),
          eq(workflows.enabled, true),
          eq(workflows.triggerType, "workflow"),
        ),
      );

    if (children.length === 0) return;

    const { fire } = decideChildren(envelope, declaredSignals, children);

    for (const child of fire) {
      try {
        /*
         * Through `enqueueRun`, not a bare insert.
         *
         * A chain multiplies runs, exactly what the per-user hourly/daily
         * ceilings exist to bound — a bare insert would let a chain walk
         * straight past the quota that a cron storm can't. It also gets the
         * constraint handling (already running, duplicate event) every other
         * caller relies on.
         */
        const queued = await enqueueRun(child.id, "workflow", {
          parentRunId,
          triggerPayload: {
            parentSlug: workflow.slug,
            parentName: workflow.name,
            digest: envelope.digest,
            signals: envelope.signals,
            severity: envelope.severity,
          },
        });

        // A refusal is a real outcome — over quota, or already running —
        // and dropping it silently leaves a chain that "just didn't fire"
        // with nothing to say why.
        if (queued.skipped) {
          console.warn(
            `[chain] ${workflow.slug} -> ${child.id} not queued: ${queued.reason}`,
          );
        }
      } catch (err) {
        // `enqueueRun` returns refusals rather than throwing, so reaching
        // here is a database fault on one child. The parent already
        // delivered; the rest of the chain still gets a turn.
        console.error(`[chain] could not enqueue ${child.id}`, err);
      }
    }
  } catch (err) {
    console.error(`[chain] ${workflow.slug} failed to enqueue children`, err);
  }
}

async function failRun(
  runId: string,
  startedAt: number,
  message: string,
  extra: { errorCode?: string; errorToolkits?: string[] } = {},
) {
  await db
    .update(runs)
    .set({
      status: "error",
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      error: message,
      errorCode: extra.errorCode ?? null,
      errorToolkits: extra.errorToolkits ?? [],
    })
    .where(eq(runs.id, runId));
}

/**
 * Counts a run lost to a broken connection, and pauses the workflow once
 * that's happened often enough in a row.
 *
 * Without the pause, a workflow whose Slack was revoked in January is still
 * generating one failed run per schedule in March. `pausedReason` lets a
 * later reconnect re-enable exactly these and nothing else.
 */
async function noteConnectionFailure(workflowId: string) {
  const [row] = await db
    .update(workflows)
    .set({ connectionFailures: sql`${workflows.connectionFailures} + 1` })
    .where(eq(workflows.id, workflowId))
    .returning({ failures: workflows.connectionFailures });

  if ((row?.failures ?? 0) >= LIMITS.maxConnectionFailures) {
    await db
      .update(workflows)
      .set({ enabled: false, pausedReason: "needs_reconnect" })
      .where(eq(workflows.id, workflowId));
  }
}

/**
 * Why the run was cut short, phrased for `runs.error`, or null if it finished
 * on its own terms.
 *
 * Handed to the *next* run as a "last time you…" hint, so which bound it
 * names matters: telling a run to fetch less when the real problem was a
 * model looping on local `query` calls thins the next digest for no reason
 * and hides the actual fault.
 */
export function truncationReason(
  result: { finishReason: string; steps: unknown[] },
  workflow: Workflow,
): string | null {
  if (result.finishReason === "length") {
    return "the model's reply hit its output length limit — the digest may be incomplete";
  }
  if (result.finishReason !== "tool-calls") return null;

  // Shares `loopBoundHit` with `stopWhen` so the two never disagree about
  // when a run hit the cap — otherwise a run that stopped at the cap could
  // get recorded as a clean `ok`.
  const bound = loopBoundHit(
    result.steps as Array<{ toolCalls?: Array<{ toolName: string }> }>,
    workflow.maxSteps,
  );

  if (bound === "external-steps") {
    return `stopped after ${workflow.maxSteps} steps — the digest may be incomplete`;
  }
  if (bound === "total-steps") {
    return `stopped after ${result.steps.length} steps: too many local query/inspect calls, without spending the ${workflow.maxSteps}-step tool budget — the digest may be incomplete`;
  }
  return null;
}

/**
 * Said in the digest, and in the error of a run already going badly.
 *
 * `runs.error` renders inside a `<pre>` on the run page (see
 * `src/app/runs/[id]/page.tsx`), showing markdown literally rather than
 * interpreting it — so the error-column use needs the plain-text form.
 */
function degradedNote(
  state: HarnessState,
  format: "markdown" | "plain" = "markdown",
): string {
  const count = state.degradedReads;
  const text = `Some fetched data could not be read this run (${count} read${count === 1 ? "" : "s"} unavailable), so this digest may be incomplete.`;
  return format === "markdown" ? `_${text}_` : text;
}

/**
 * The last digest this workflow actually produced. Feeding it back turns a
 * scheduled report into a delta — without it, every run re-reports the same
 * open PRs and unread mail every morning.
 */
async function previousDigest(
  workflowId: string,
): Promise<{ body: string; at: Date } | null> {
  const [row] = await db
    .select({ body: outputs.body, at: outputs.createdAt })
    .from(outputs)
    .innerJoin(runs, eq(outputs.runId, runs.id))
    .where(
      and(
        eq(runs.workflowId, workflowId),
        inArray(runs.status, ["ok", "truncated"]),
        eq(outputs.unchanged, false),
      ),
    )
    .orderBy(desc(outputs.createdAt))
    .limit(1);

  return row ?? null;
}

/**
 * What went wrong last time, so this run can route around it: a truncated
 * run means the plan was too wide for the step budget, an errored one names
 * the tool or timeout that sank it.
 */
async function previousFailure(workflowId: string): Promise<{
  status: string;
  error: string;
  errorCode: string | null;
  at: Date;
} | null> {
  // Only the *immediately preceding* finished run matters — an error three
  // runs back that later runs sailed past is noise, not guidance. (The
  // currently executing run is still "running", so it can't match here.)
  const [row] = await db
    .select({
      status: runs.status,
      error: runs.error,
      errorCode: runs.errorCode,
      at: runs.finishedAt,
    })
    .from(runs)
    .where(
      and(
        eq(runs.workflowId, workflowId),
        inArray(runs.status, ["error", "truncated", "ok"]),
      ),
    )
    .orderBy(desc(runs.finishedAt))
    .limit(1);

  if (!row || row.status === "ok" || !row.error || !row.at) return null;
  return {
    status: row.status,
    error: row.error,
    errorCode: row.errorCode ?? null,
    at: row.at,
  };
}

/** URLs in the goal/payload are what the agent must actually fetch, not recall. */
const URL_PATTERN = /https?:\/\/\S+/gi;

/** "42 minutes" / "3 hours" / "2 days" — a daily digest is not "0 days old". */
function humanizeAge(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Recognises the payload a parent hands a chained child.
 *
 * A shape check rather than a flag: the same column also carries Composio
 * event payloads, which are whatever the third party sent.
 */
function asChainPayload(payload: unknown): {
  parentName: string;
  digest: string;
  signals: Record<string, unknown>;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.digest !== "string" || !record.parentSlug) return null;
  return {
    parentName:
      typeof record.parentName === "string"
        ? record.parentName
        : String(record.parentSlug),
    digest: record.digest,
    signals:
      record.signals && typeof record.signals === "object"
        ? (record.signals as Record<string, unknown>)
        : {},
  };
}

function buildPrompt(
  workflow: Workflow,
  previous: { body: string; at: Date } | null,
  failure: {
    status: string;
    error: string;
    errorCode: string | null;
    at: Date;
  } | null,
  triggerPayload: unknown,
  now: Date,
): string {
  const stamp = now.toLocaleString("en-US", {
    timeZone: workflow.timezone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const parts = [
    `Right now it is ${stamp} (${workflow.timezone}), ${now.toISOString()} UTC.`,
    workflow.goal,
  ];

  // Scan the payload too: an event workflow's URL usually arrives in the
  // event, not in the goal written months earlier.
  const payloadJson = triggerPayload ? JSON.stringify(triggerPayload) : "";
  const urls = [
    ...new Set([
      ...(workflow.goal.match(URL_PATTERN) ?? []),
      ...(payloadJson.match(URL_PATTERN) ?? []),
    ]),
  ].map((u) => u.replace(/[\\"',)\]}>.]+$/, ""));
  if (urls.length) {
    parts.push(
      `---\nThe goal above references ${urls.length === 1 ? "this URL" : "these URLs"}:\n${urls
        .map((u) => `- ${u}`)
        .join(
          "\n",
        )}\nFetch ${urls.length === 1 ? "it" : "each of them"} with a tool this run and use only what comes back today — do not answer from what you already know about ${urls.length === 1 ? "that page" : "those pages"}.`,
    );
  }

  if (previous) {
    const age = humanizeAge(now.getTime() - previous.at.getTime());
    parts.push(
      `---\nYour previous digest for this workflow, from ${previous.at.toISOString()} (${age} ago):\n\n${previous.body.slice(
        0,
        MEMORY_CHARS,
      )}\n\nThat digest is ${age} old — re-verify any time-sensitive figures in it against a live source before repeating them, and report only what is new or changed since then. Where a tool lets you filter by time, "new" means created or updated after ${previous.at.toISOString()} — use that cutoff explicitly rather than judging recency by eye.`,
    );
  }

  if (failure) {
    const age = humanizeAge(now.getTime() - failure.at.getTime());
    parts.push(
      // FINDING 1: a degraded-blind run stopped for the opposite reason a
      // step-cap truncation did — it fetched fine but ran out of local
      // `query`/`inspect` budget before finishing reading. Feeding it the
      // step-cap branch's "fewer tool calls" line tells the next run to
      // fetch less, exactly backwards: the fetches weren't the problem, the
      // reading was.
      failure.errorCode === "degraded_reads"
        ? `---\nHeads-up: your previous attempt (${age} ago) fetched data it ran out of budget to finish reading — "${failure.error}". The fetching was fine; this time read what you fetch more narrowly — fewer, more targeted \`query\`/\`inspect\` calls per handle — rather than fetching less.`
        : failure.status === "truncated"
          ? `---\nHeads-up: your previous attempt (${age} ago) ran out of steps before finishing — "${failure.error}". Plan tighter this time: fewer, more targeted tool calls, and write the digest before the budget runs out.`
          : `---\nHeads-up: your previous attempt (${age} ago) failed with: "${failure.error}". If that error points at a specific tool or source, try a different tool or a narrower query for it this run rather than repeating the same call — and if it still fails, say so in the digest instead of erroring out.`,
    );
  }

  /*
   * A chained run is handed its parent's digest — markdown a model wrote for
   * a human, not an event payload.
   *
   * Dumping it through `JSON.stringify` escaped every newline and quote,
   * spent tokens on the escapes, and — since the slice below caps the whole
   * blob — could cut the JSON mid-string, handing the model something that
   * doesn't parse. As prose it reads the way the parent wrote it.
   */
  const chained = asChainPayload(triggerPayload);
  if (chained) {
    parts.push(
      `---\nThis run was triggered by "${chained.parentName}" finishing. What it reported:\n\n${chained.digest.slice(
        0,
        MEMORY_CHARS,
      )}`,
    );
    if (Object.keys(chained.signals).length > 0) {
      parts.push(
        `Its measured values:\n${Object.entries(chained.signals)
          .map(([key, value]) => `- ${key}: ${value}`)
          .join("\n")}`,
      );
    }
    parts.push(
      "Build on that rather than repeating it — your job is the next step, not a restatement.",
    );
  } else if (triggerPayload) {
    parts.push(
      `---\nThis run was started by an event. Event payload:\n\n\`\`\`json\n${JSON.stringify(
        triggerPayload,
        null,
        2,
      ).slice(0, MEMORY_CHARS)}\n\`\`\``,
    );
  }

  return parts.join("\n\n");
}

/** Big tool payloads are summarised rather than stored whole. */
function truncateForTrace(output: unknown): object | null {
  if (output == null) return null;
  const json = JSON.stringify(output);
  if (json.length <= MAX_STEP_RESULT_CHARS) return output as object;
  return {
    truncated: true,
    originalChars: json.length,
    preview: json.slice(0, MAX_STEP_RESULT_CHARS),
  };
}

export type DeliveryLogEntry = {
  type: string;
  ok: boolean;
  /** Not attempted (nothing new to send) — distinct from tried and failed. */
  skipped?: boolean;
  error?: string;
};

/**
 * Turns the per-target log into the one word the dashboard shows.
 *
 * A `skipped` entry is the design working — "nothing new to send" — so it
 * never makes a delivery look failed. Only an attempted-and-failed target
 * does, the same distinction the hash flush already makes.
 */
export function deliveryStatusFrom(
  log: DeliveryLogEntry[],
  attempted: boolean,
): "delivered" | "partial" | "failed" | "skipped" {
  if (!attempted) return "skipped";

  const real = log.filter((entry) => !entry.skipped);
  if (real.length === 0) return "skipped";

  const failures = real.filter((entry) => !entry.ok).length;
  if (failures === 0) return "delivered";
  if (failures === real.length) return "failed";
  return "partial";
}

/**
 * Records what actually reached each target. Tool-backed targets (Slack,
 * email) are verified against calls the model really made; webhooks are
 * POSTed here. A failed target is written down as failed, not dropped.
 */
async function deliverOutput({
  workflow,
  deliver,
  body,
  unchanged,
  calledTools,
}: {
  workflow: Workflow;
  deliver: DeliverTarget[];
  body: string;
  unchanged: boolean;
  calledTools: string[];
}): Promise<DeliveryLogEntry[]> {
  const log: DeliveryLogEntry[] = [];

  for (const target of deliver) {
    if (target.type === "dashboard") {
      // Writing the output row *is* the dashboard delivery.
      log.push({ type: "dashboard", ok: true });
      continue;
    }

    // Nothing new means nothing to send but the dashboard — the design
    // working, not a failure. The flag keeps the run page from labelling a
    // quiet morning as "slack · failed".
    if (unchanged) {
      log.push({
        type: target.type,
        ok: false,
        skipped: true,
        error: "nothing new to send",
      });
      continue;
    }

    if (target.type === "webhook") {
      log.push(await postWebhook(target.url, workflow, body));
      continue;
    }

    const slug = DELIVER_TOOL_SLUGS[target.type];
    const ok = Boolean(slug && calledTools.includes(slug));
    log.push({
      type: target.type,
      ok,
      error: ok ? undefined : `agent never called ${slug}`,
    });
  }

  return log;
}

/**
 * Re-sends digests whose delivery failed, one bounded sweep per tick.
 *
 * Webhooks only — a real limit, not an oversight. A webhook is the one
 * target this server actually performs; Slack and email deliveries are made
 * by the agent calling a tool, and `deliverOutput` only *verifies* that it
 * did. Re-sending those means running the agent again — a new run and a new
 * bill, not a retry — so a failed Slack delivery settles as failed.
 *
 * Only targets that actually failed are retried, read back from
 * `deliveryLog`: re-sending an already-succeeded one would deliver the same
 * digest twice, worse than the failure being retried.
 */
export async function retryPendingDeliveries(
  budgetLeft: () => boolean,
): Promise<number> {
  let retried = 0;
  /** Rows already attempted this sweep — see the note on the query below. */
  const seen = new Set<string>();

  while (budgetLeft()) {
    const [row] = await db
      .select({
        outputId: outputs.id,
        body: outputs.body,
        log: outputs.deliveryLog,
        attempts: outputs.deliveryAttempts,
        workflow: workflows,
      })
      .from(outputs)
      .innerJoin(runs, eq(outputs.runId, runs.id))
      .innerJoin(workflows, eq(runs.workflowId, workflows.id))
      .where(
        and(
          sql`${outputs.deliveryStatus} in ('pending', 'partial', 'failed')`,
          sql`${outputs.deliveryAttempts} < ${LIMITS.maxDeliveryAttempts}`,
          /*
           * One attempt per row per sweep.
           *
           * Without this the loop re-picks the row it just retried — still
           * failed, still under the attempt cap — burning all three attempts
           * within milliseconds, no time for the endpoint to come back.
           * Excluding here rather than breaking out keeps other rows moving.
           */
          seen.size > 0 ? notInArray(outputs.id, [...seen]) : undefined,
        ),
      )
      .orderBy(outputs.createdAt)
      .limit(1);

    if (!row) break;
    seen.add(row.outputId);

    const previous = (row.log ?? []) as DeliveryLogEntry[];
    const failedTypes = new Set(
      previous.filter((e) => !e.ok && !e.skipped).map((e) => e.type),
    );

    const targets = ((row.workflow.deliver as DeliverTarget[]) ?? []).filter(
      (t) => t.type === "webhook" && failedTypes.has(t.type),
    );

    const attempts = row.attempts + 1;

    if (targets.length === 0) {
      /*
       * Nothing here can be retried — the failures were tool-based, or the
       * target's since been removed. Settle rather than spin: otherwise the
       * row gets picked up every tick until it ages out of retention.
       *
       * Settled at whatever the log actually says, not at `failed`. A row
       * whose webhook succeeded earlier and whose Slack send is unretryable
       * is `partial` — writing `failed` over it would misreport a digest that
       * did reach a reader.
       */
      await db
        .update(outputs)
        .set({
          deliveryStatus: deliveryStatusFrom(previous, true),
          deliveryAttempts: LIMITS.maxDeliveryAttempts,
        })
        .where(eq(outputs.id, row.outputId));
      continue;
    }

    /*
     * `calledTools` is empty and `unchanged` false: neither matters here,
     * since every target in this set is a webhook, posted directly rather
     * than verified against what the agent called.
     *
     * `postWebhook` re-checks the URL through `safe-url.ts` on every attempt,
     * so a hostname repointed at a private address since the first send is
     * refused here too, not trusted because it passed once.
     */
    const log = await deliverOutput({
      workflow: row.workflow,
      deliver: targets,
      body: row.body,
      unchanged: false,
      calledTools: [],
    });

    const merged = [
      ...previous.filter((e) => !log.some((l) => l.type === e.type)),
      ...log,
    ];
    const status = deliveryStatusFrom(merged, true);

    await db
      .update(outputs)
      .set({
        deliveryLog: merged,
        deliveryAttempts: attempts,
        deliveredTo: merged.filter((d) => d.ok).map((d) => d.type),
        deliveryStatus:
          status === "delivered"
            ? "delivered"
            : attempts >= LIMITS.maxDeliveryAttempts
              ? "failed"
              : status,
      })
      .where(eq(outputs.id, row.outputId));

    retried++;
  }

  return retried;
}

async function postWebhook(
  url: string,
  workflow: Workflow,
  body: string,
): Promise<DeliveryLogEntry> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow: { id: workflow.id, slug: workflow.slug, name: workflow.name },
        deliveredAt: new Date().toISOString(),
        format: "markdown",
        body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok
      ? { type: "webhook", ok: true }
      : { type: "webhook", ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      type: "webhook",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
