import { generateText, stepCountIs, type ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";
import { composio, COMPOSIO_USER_ID } from "@/lib/composio";
import { runCostUsd, toCostColumn } from "@/lib/run-cost";
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

const SYSTEM_PROMPT = `You are a personal automation agent running an unattended, scheduled workflow.

Rules:
- You are READ-ONLY. Only the tools you've been given exist for you — there is
  no other way to take action, so never claim to have sent, created, or
  changed anything unless you actually called a tool that did it.
- Be concise. Your final answer is a short markdown digest a human will
  skim on a phone: headline first, then a tight bulleted list. No preamble,
  no "here is a summary of...".
- If a tool call fails or returns nothing, say so plainly in one line rather
  than guessing or inventing content.
- If you are shown a previous digest, report only what changed since it.
  Do not repeat items it already covered.
- If nothing has changed since the previous digest, reply with exactly
  ${NO_UPDATES} and nothing else, and do not call any delivery tool. Silence
  is better than a digest that says "no updates" in ten words.`;

type EnqueueResult =
  | { runId: string; skipped?: false }
  | { runId: null; skipped: true; reason: string };

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

  try {
    const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
    const toolkits = [
      ...new Set([...workflow.toolkits, ...deliverToolkits(deliver)]),
    ];

    const allTools = (await composio.tools.get(COMPOSIO_USER_ID, {
      toolkits,
    })) as ToolSet;

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

    const previous = await previousDigest(workflow.id);

    const result = await generateText({
      model: gateway(workflow.model),
      system: deliverInstructions
        ? `${SYSTEM_PROMPT}\n\n${deliverInstructions}`
        : SYSTEM_PROMPT,
      prompt: buildPrompt(workflow, previous, run.triggerPayload),
      tools,
      stopWhen: stepCountIs(workflow.maxSteps),
      abortSignal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      onStepFinish: async (step) => {
        for (const call of step.toolCalls ?? []) {
          const matchingResult = step.toolResults?.find(
            (r) => r.toolCallId === call.toolCallId,
          );
          await recordStep({
            type: "tool",
            toolSlug: call.toolName,
            argsJson: call.input as object,
            resultJson: truncateForTrace(matchingResult?.output),
          });
        }
        if (step.text) {
          await recordStep({ type: "text", resultJson: { text: step.text } });
        }
      },
    });

    const body = result.text.trim();
    const unchanged = body === NO_UPDATES || body === "";

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
        costUsd: toCostColumn(await runCostUsd(workflow.model, usage)),
        error: truncated
          ? `stopped after ${workflow.maxSteps} steps — the digest may be incomplete`
          : null,
      })
      .where(eq(runs.id, runId));

    // Only a completed run counts as "last ran" for display purposes.
    if (!truncated) {
      await db
        .update(workflows)
        .set({ lastRunAt: new Date() })
        .where(eq(workflows.id, workflow.id));
    }

    return { runId, status: truncated ? "truncated" : "ok" };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "TimeoutError" || err.name === "AbortError"
          ? `run exceeded ${RUN_TIMEOUT_MS / 1000}s and was aborted`
          : err.message
        : String(err);
    await failRun(runId, startedAt, message);
    return { runId, status: "error", error: message };
  }
}

async function failRun(runId: string, startedAt: number, message: string) {
  await db
    .update(runs)
    .set({
      status: "error",
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      error: message,
    })
    .where(eq(runs.id, runId));
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

function buildPrompt(
  workflow: Workflow,
  previous: { body: string; at: Date } | null,
  triggerPayload: unknown,
): string {
  const parts = [workflow.goal];

  if (previous) {
    parts.push(
      `---\nYour previous digest for this workflow, from ${previous.at.toISOString()}:\n\n${previous.body.slice(
        0,
        MEMORY_CHARS,
      )}\n\nReport only what is new or changed since then.`,
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

export type DeliveryLogEntry = { type: string; ok: boolean; error?: string };

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

    // Nothing new means nothing to send anywhere but the dashboard.
    if (unchanged) {
      log.push({ type: target.type, ok: false, error: "skipped — no updates" });
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
