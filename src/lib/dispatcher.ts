import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, users, workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";
import { isDue } from "@/lib/schedule";
import { checkConnectionsWith, requiredToolkits } from "@/lib/connection-gate";
import { activeToolkitsByUser } from "@/lib/data/connections";
import { getProviderForUser } from "@/lib/provider";
import { hasProviderKey } from "@/lib/provider-keys";
import { LIMITS } from "@/lib/limits";

/**
 * How long one tick may spend starting runs. The route's `maxDuration` is
 * 300s and a single run may take up to 240s, so the dispatcher stops handing
 * out work well before the function is killed — anything left over is still
 * due on the next tick, because `lastAttemptAt` only moves for workflows that
 * actually started.
 */
const TICK_BUDGET_MS = 240_000;

/** How often a workflow blocked on a connection gets a run row recorded. */
const BLOCKED_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type DispatchResult = {
  workflowId: string;
  slug: string;
  status: string;
  error?: string;
};

type Workflow = typeof workflows.$inferSelect;

export async function runDueWorkflows(now: Date = new Date()) {
  const enabled = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.enabled, true), eq(workflows.triggerType, "cron")));

  const results: DispatchResult[] = [];
  const tickStartedAt = Date.now();

  // Work out what's due first, so the fairness pass below has the real set.
  const due: Workflow[] = [];
  for (const workflow of enabled) {
    try {
      if (
        isDue(workflow.cron, workflow.timezone, workflow.lastAttemptAt, now)
      ) {
        due.push(workflow);
      }
    } catch (err) {
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "invalid_cron",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (due.length === 0) return results;

  /*
   * Group by owner and interleave.
   *
   * A flat loop over due workflows spends the tick budget in whatever order
   * the rows came back, so one account with ten due workflows can consume the
   * whole 240 seconds and starve everyone else — every tick, forever, since
   * their workflows stay due. Round-robin makes the budget shortfall land on
   * everyone equally.
   */
  const byUser = new Map<string, Workflow[]>();
  for (const workflow of due) {
    const key = workflow.userId ?? "";
    if (!key) {
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "no_owner",
      });
      continue;
    }
    byUser.set(key, [...(byUser.get(key) ?? []), workflow]);
  }

  const userIds = [...byUser.keys()];

  /*
   * Everything per-user is resolved once per tick rather than once per
   * workflow: account status, whether they have a usable provider key, and
   * which of their toolkits are connected.
   */
  const [accounts, activeToolkits] = await Promise.all([
    db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(sql`${users.id} = any(${userIds})`),
    activeToolkitsByUser(userIds),
  ]);
  const statusById = new Map(accounts.map((a) => [a.id, a.status]));

  const runnable = new Map<string, boolean>();
  for (const userId of userIds) {
    if (statusById.get(userId) !== "active") {
      runnable.set(userId, false);
      continue;
    }
    // Bring-your-own-key: no key means no run. Skipping here rather than
    // enqueuing is the difference between one banner on the workflows page and
    // 288 identical failed runs a day for an account that never finished
    // setting up.
    const provider = await getProviderForUser(userId);
    runnable.set(userId, await hasProviderKey(userId, provider));
  }

  const queues = userIds.map((userId) => ({
    userId,
    items: byUser.get(userId) ?? [],
  }));

  let index = 0;
  while (queues.some((q) => q.items.length > 0)) {
    const queue = queues[index % queues.length];
    index++;
    const workflow = queue.items.shift();
    if (!workflow) continue;

    const userId = queue.userId;

    if (!runnable.get(userId)) {
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status:
          statusById.get(userId) !== "active"
            ? "owner_inactive"
            : "no_provider_key",
      });
      continue;
    }

    // Blocked on a connection: cheap to detect, and worth detecting before
    // spending a model call to discover the same thing.
    const required = await requiredToolkits(workflow);
    const gate = checkConnectionsWith(
      activeToolkits.get(userId) ?? new Set(),
      required,
    );

    if (!gate.ok) {
      await handleBlocked(workflow, gate.blocked);
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "needs_reconnect",
        error: gate.reason,
      });
      continue;
    }

    if (Date.now() - tickStartedAt > TICK_BUDGET_MS) {
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "deferred_to_next_tick",
      });
      continue;
    }

    // Sequential on purpose: a shared Vercel function has one duration
    // budget (maxDuration) to split across every due workflow in this
    // tick, and sequential execution keeps failures isolated and simple
    // to reason about. Revisit if the due-count per tick grows.
    try {
      const result = await runWorkflow(workflow, "cron");
      results.push({ workflowId: workflow.id, slug: workflow.slug, ...result });
    } catch (err) {
      /*
       * `executeRun` writes its own failures to the run row, so reaching here
       * means the claim itself failed — a dropped database connection, most
       * likely. Unhandled, that aborted the whole tick and every workflow
       * after this one silently missed its slot until the next one.
       */
      console.error(`[dispatch] ${workflow.slug} failed to start`, err);
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "failed_to_start",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Records a workflow that couldn't run for want of a connection.
 *
 * Three things have to happen, and each fixes a distinct failure mode:
 *
 *  - `lastAttemptAt` moves, or the workflow stays due and is re-evaluated on
 *    every five-minute tick forever.
 *  - A run row is written *at most once a day*, so the user sees the problem
 *    on /runs once instead of 288 identical rows.
 *  - The failure streak advances, and the workflow is paused at the limit.
 */
async function handleBlocked(workflow: Workflow, blocked: string[]) {
  const now = new Date();

  const [recent] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.workflowId, workflow.id),
        eq(runs.errorCode, "needs_reconnect"),
        gt(runs.createdAt, new Date(Date.now() - BLOCKED_RUN_INTERVAL_MS)),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);

  if (!recent) {
    await db.insert(runs).values({
      workflowId: workflow.id,
      trigger: "cron",
      status: "error",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      error: `Blocked: needs a working connection to ${blocked.join(", ")}.`,
      errorCode: "needs_reconnect",
      errorToolkits: blocked,
    });
  }

  const [updated] = await db
    .update(workflows)
    .set({
      lastAttemptAt: now,
      connectionFailures: sql`${workflows.connectionFailures} + 1`,
    })
    .where(eq(workflows.id, workflow.id))
    .returning({ failures: workflows.connectionFailures });

  if ((updated?.failures ?? 0) >= LIMITS.maxConnectionFailures) {
    await db
      .update(workflows)
      .set({ enabled: false, pausedReason: "needs_reconnect" })
      .where(eq(workflows.id, workflow.id));
  }
}
