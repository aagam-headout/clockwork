import { generateText, stepCountIs, type ToolSet } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";
import { getToolsFor } from "@/lib/composio";
import { runCostUsd, toCostColumn } from "@/lib/run-cost";
import { MissingProviderKeyError, resolveModelForUser } from "@/lib/provider";
import { redactSecrets } from "@/lib/crypto/secrets";
import {
  checkConnections,
  isAuthError,
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

type Workflow = typeof workflows.$inferSelect;

/**
 * Hard ceiling on one run's model+tool loop. Deliberately under the route's
 * `maxDuration` (300s) so a stuck tool call fails as a recorded error with
 * time left to write it, instead of the whole function being killed mid-run.
 */
export const RUN_TIMEOUT_MS = 240_000;

/** Tool results are stored for the trace, not as a data lake. */
const MAX_STEP_RESULT_CHARS = 8_000;

/** How much of the previous digest is worth re-reading for context. */
const MEMORY_CHARS = 4_000;

/** The agent's exact reply when nothing happened since the last digest. */
export const NO_UPDATES = "NO_UPDATES";

/**
 * Deliberately static per workflow — every per-run fact (current time,
 * previous digest, event payload) lives in the user prompt instead. A stable
 * system prompt + tool schema prefix is what lets the provider's prompt cache
 * hit across the steps of a run and across closely-spaced runs.
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
- If nothing has changed since the previous digest, reply with exactly
  ${NO_UPDATES} and nothing else, and do not call any delivery tool. Silence
  is better than a digest that says "no updates" in ten words.`;
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
 * Not atomic — it counts and then inserts, so two simultaneous requests can
 * both squeeze past. That's acceptable: the dangerous duplicate (two runs of
 * the *same* workflow) is prevented by a database index, and these ceilings
 * exist to stop sustained abuse, not to be exact to the unit. The atomic
 * version costs an advisory lock per run for no practical gain.
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
 * Claims a run slot for a workflow. The `runs_one_active_per_workflow`
 * partial unique index is what actually prevents a double execution when a
 * cron tick and a "Run now" click land together — this just turns the
 * resulting constraint violation into an ordinary "skipped" answer.
 */
export async function enqueueRun(
  workflowId: string,
  trigger: "cron" | "manual" | "event",
  options: { triggerRef?: string; triggerPayload?: unknown } = {},
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
      })
      .returning({ id: runs.id });

    // Stamped on the attempt, not on success: a workflow that errors every
    // time must not stay "due" and re-fire on every tick.
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
  // Claiming is a conditional update: only the caller that flips the row out
  // of `queued` gets to run it.
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
    const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
    const toolkits = [
      ...new Set([...workflow.toolkits, ...deliverToolkits(deliver)]),
    ];

    /*
     * Preflight. Cheaper than discovering the same thing one failed tool call
     * at a time, and — more to the point — it produces an honest verdict. A run
     * that can't reach its apps used to end as `ok` with a digest apologising
     * for it.
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

    /*
     * Toolkits whose credentials the provider rejected mid-run. Collected
     * during the loop and acted on after it: a run can't be un-started, but it
     * can be recorded truthfully.
     */
    const authFailed = new Set<string>();

    const result = await generateText({
      model: await resolveModelForUser(ownerId, workflow.model),
      system: deliverInstructions
        ? `${system}\n\n${deliverInstructions}`
        : system,
      prompt: buildPrompt(workflow, previous, failure, run.triggerPayload, now),
      tools,
      stopWhen: stepCountIs(workflow.maxSteps),
      abortSignal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      onStepFinish: async (step) => {
        for (const call of step.toolCalls ?? []) {
          const matchingResult = step.toolResults?.find(
            (r) => r.toolCallId === call.toolCallId,
          );

          // Composio reports failures in the result body rather than throwing,
          // so a rejected credential arrives here as an ordinary value.
          const output = matchingResult?.output as
            { successful?: boolean; error?: string | null } | undefined;
          const failed = output?.successful === false;

          if (failed && isAuthError(output?.error)) {
            const toolkit = toolkitForSlug(call.toolName, toolkits);
            if (toolkit) authFailed.add(toolkit);
          }

          await recordStep({
            type: "tool",
            toolSlug: call.toolName,
            argsJson: call.input as object,
            resultJson: truncateForTrace(matchingResult?.output),
            // Previously every tool step was recorded with `error: null`, so a
            // trace showed a failed call as an ordinary one.
            error: failed ? (output?.error ?? "tool call failed") : null,
          });
        }
        if (step.text) {
          await recordStep({ type: "text", resultJson: { text: step.text } });
        }
      },
    });

    const body = result.text.trim();
    const unchanged = body === NO_UPDATES || body === "";

    /*
     * The run got past the preflight but a credential was rejected while it
     * ran — the token expired between the check and the call, or Composio's
     * status hadn't caught up yet.
     *
     * This is the case that used to be recorded as a success: the agent is
     * told to report tool failures in one line, so the run ended `ok` with a
     * digest saying it couldn't read Slack, and the dashboard showed green.
     * The digest is still saved as a trace, but the run is an error and the
     * connection is marked so the next run is blocked at the gate instead.
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
      });

      const message = `Authorisation failed for ${blocked.join(", ")} during the run — reconnect it.`;
      await failRun(runId, startedAt, message, {
        errorCode: "needs_reconnect",
        errorToolkits: blocked,
      });
      await noteConnectionFailure(workflow.id);
      return { runId, status: "error", error: message };
    }

    // The model ran out of steps mid-task: the digest it produced is a
    // fragment, and saying "ok" about it would be a lie.
    const truncated =
      result.finishReason === "length" || hitStepCap(result, workflow);

    const deliveryLog = await deliverOutput({
      workflow,
      deliver,
      body,
      unchanged,
      calledTools: result.toolCalls.map((c) => c.toolName),
    });

    await db.insert(outputs).values({
      runId,
      format: "markdown",
      body,
      unchanged,
      deliveredTo: deliveryLog.filter((d) => d.ok).map((d) => d.type),
      deliveryLog,
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
        status: truncated ? "truncated" : "ok",
        finishReason: result.finishReason ?? null,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        costUsd: toCostColumn(await runCostUsd(workflow.model, usage, ownerId)),
        error: truncated
          ? `stopped after ${workflow.maxSteps} steps — the digest may be incomplete`
          : null,
      })
      .where(eq(runs.id, runId));

    // Only a completed run counts as "last ran" for display purposes.
    if (!truncated) {
      await db
        .update(workflows)
        // A run that reached its apps clears the connection-failure streak —
        // otherwise one bad afternoon would eventually pause a workflow that
        // has been healthy ever since.
        .set({ lastRunAt: new Date(), connectionFailures: 0 })
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
 * that has happened often enough in a row.
 *
 * Without the pause, a workflow whose Slack was revoked in January is still
 * generating one failed run per schedule in March. The `pausedReason` is what
 * lets a later reconnect re-enable exactly these and nothing else.
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

/** True when the loop stopped only because it ran into `maxSteps`. */
function hitStepCap(
  result: { finishReason: string; steps: unknown[] },
  workflow: Workflow,
): boolean {
  return (
    result.finishReason === "tool-calls" &&
    result.steps.length >= workflow.maxSteps
  );
}

/**
 * The last digest this workflow actually produced. Feeding it back is what
 * turns a scheduled report into a delta — without it every run re-reports
 * the same open PRs and the same unread mail, every morning.
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
 * What went wrong last time, so this run can route around it instead of
 * repeating it: a truncated run means the plan was too wide for the step
 * budget, an errored one names the tool or timeout that sank it.
 */
async function previousFailure(
  workflowId: string,
): Promise<{ status: string; error: string; at: Date } | null> {
  // Only the *immediately preceding* finished run matters: an error three
  // runs back that later runs sailed past is noise, not guidance. (The run
  // currently executing is still "running", so it can't match here.)
  const [row] = await db
    .select({ status: runs.status, error: runs.error, at: runs.finishedAt })
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
  return { status: row.status, error: row.error, at: row.at };
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

function buildPrompt(
  workflow: Workflow,
  previous: { body: string; at: Date } | null,
  failure: { status: string; error: string; at: Date } | null,
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
      failure.status === "truncated"
        ? `---\nHeads-up: your previous attempt (${age} ago) ran out of steps before finishing — "${failure.error}". Plan tighter this time: fewer, more targeted tool calls, and write the digest before the budget runs out.`
        : `---\nHeads-up: your previous attempt (${age} ago) failed with: "${failure.error}". If that error points at a specific tool or source, try a different tool or a narrower query for it this run rather than repeating the same call — and if it still fails, say so in the digest instead of erroring out.`,
    );
  }

  if (triggerPayload) {
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
 * Records what actually reached each target. Tool-backed targets (Slack,
 * email) are verified against the calls the model really made; webhooks are
 * POSTed here. A target that failed is written down as failed rather than
 * quietly dropped.
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

    // Nothing new means nothing to send anywhere but the dashboard. That is
    // the design working, not a delivery failure — the flag is what keeps the
    // run page from labelling a quiet morning as "slack · failed".
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
