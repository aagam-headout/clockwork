import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, users, workflows } from "@/db/schema";
import {
  executeRun,
  retryPendingDeliveries,
  runWorkflow,
} from "@/lib/executor";
import { isDue } from "@/lib/schedule";
import { checkConnectionsWith, requiredToolkits } from "@/lib/connection-gate";
import { activeToolkitsByUser } from "@/lib/data/connections";
import { getProviderForUser } from "@/lib/provider";
import { hasProviderKey } from "@/lib/provider-keys";
import { LIMITS } from "@/lib/limits";

/**
 * How long one tick may spend starting runs. The route's `maxDuration` is
 * 300s and a run may take up to 240s, so the dispatcher stops well before
 * the function is killed — leftovers stay due, since `lastAttemptAt` only
 * moves for workflows that actually started.
 */
const TICK_BUDGET_MS = 240_000;

/** How often a workflow blocked on a connection gets a run row recorded. */
const BLOCKED_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type DispatchResult = {
  workflowId: string;
  slug: string;
  status: string;
  error?: string;
  /** Set for chained runs, which are claimed by id rather than by workflow. */
  runId?: string;
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

  // Still drain: a tick with nothing due may have chained runs left over.
  if (due.length === 0) {
    results.push(...(await drainChainedRuns(tickStartedAt)));
    return results;
  }

  /*
   * Group by owner and interleave.
   *
   * A flat loop spends the tick budget in whatever order rows came back, so
   * one account with ten due workflows could consume all 240s and starve
   * everyone else, every tick, forever. Round-robin spreads the shortfall
   * evenly.
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

  // Per-user state — account status, provider key, connected toolkits —
  // resolved once per tick, not once per workflow.
  const [accounts, activeToolkits] = await Promise.all([
    db
      .select({ id: users.id, status: users.status })
      .from(users)
      /*
       * `inArray`, not `sql\`= any(${userIds})\``. The raw form binds the
       * array as one parameter, which neon-http accepts but node-postgres
       * rejects with `22P02: Array value must start with "{"` — every tick
       * against a plain Postgres 500'd before a workflow was dispatched.
       */
      .where(inArray(users.id, userIds)),
    activeToolkitsByUser(userIds),
  ]);
  const statusById = new Map(accounts.map((a) => [a.id, a.status]));

  const runnable = new Map<string, boolean>();
  for (const userId of userIds) {
    if (statusById.get(userId) !== "active") {
      runnable.set(userId, false);
      continue;
    }
    // Bring-your-own-key: no key means no run. Skipping here, rather than
    // enqueuing, is one banner on the workflows page instead of 288 identical
    // failed runs a day for an account still mid-setup.
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

    // Cheap to detect a blocked connection here, before spending a model
    // call to discover the same thing.
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

    // Sequential on purpose: one duration budget (maxDuration) is split
    // across every due workflow this tick, and running in sequence keeps
    // failures isolated. Revisit if the due-count per tick grows.
    try {
      const result = await runWorkflow(workflow, "cron");
      results.push({ workflowId: workflow.id, slug: workflow.slug, ...result });
    } catch (err) {
      /*
       * `executeRun` writes its own failures, so reaching here means the
       * claim itself failed — most likely a dropped database connection.
       * Unhandled, that would abort the whole tick and every workflow after
       * this one would silently miss its slot until the next.
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

  results.push(...(await drainChainedRuns(tickStartedAt)));

  return results;
}

/** Chained rows read per pass. Bounded so a backlog cannot arrive all at once. */
const CHAIN_BATCH = 25;

/**
 * Round-robin over owners, oldest-first within each owner.
 *
 * Rows arrive in `created_at` order — fair between runs, unfair between
 * accounts: one user's twenty-run chain would eat the whole budget before
 * anyone else's child ran. Interleaving spreads a budget shortfall evenly,
 * same as the cron loop above.
 */
export function interleaveByOwner<T extends { userId: string | null }>(
  rows: T[],
): T[] {
  const byOwner = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.userId ?? "";
    byOwner.set(key, [...(byOwner.get(key) ?? []), row]);
  }

  const queues = [...byOwner.values()];
  const out: T[] = [];
  for (let i = 0; out.length < rows.length; i++) {
    const queue = queues[i % queues.length];
    const next = queue.shift();
    if (next) out.push(next);
  }
  return out;
}

/**
 * Runs the chained work the due loop's runs produced.
 *
 * Chained runs are inserted `queued` by their parent and executed here rather
 * than inline, so a chain can never consume another user's slice of the tick's
 * single function duration. Whatever the budget does not reach stays queued
 * and durable; the next tick takes it, and the reaper's wider window for
 * chained rows keeps a backlog from being mistaken for a claim that died.
 *
 * A batch per pass, re-queried until empty, because executing a run changes
 * the set — it may enqueue grandchildren this same pass should pick up. Rows
 * already attempted are excluded by id: a run whose *claim* threw is still
 * `queued`, and without that exclusion the loop would spin on it.
 */
export async function drainChainedRuns(
  tickStartedAt: number,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  /** Attempted this sweep, whatever came of it. */
  const seen = new Set<string>();
  /** Owner verdicts, resolved once per account per sweep. */
  const verdicts = new Map<string, Unrunnable | null>();

  while (Date.now() - tickStartedAt <= TICK_BUDGET_MS) {
    const batch = await db
      .select({
        runId: runs.id,
        slug: workflows.slug,
        userId: workflows.userId,
      })
      .from(runs)
      .innerJoin(workflows, eq(runs.workflowId, workflows.id))
      .where(
        and(
          eq(runs.status, "queued"),
          eq(runs.trigger, "workflow"),
          seen.size > 0 ? notInArray(runs.id, [...seen]) : undefined,
        ),
      )
      .orderBy(runs.createdAt)
      .limit(CHAIN_BATCH);

    if (batch.length === 0) break;

    for (const next of interleaveByOwner(batch)) {
      if (Date.now() - tickStartedAt > TICK_BUDGET_MS) break;
      seen.add(next.runId);

      /*
       * The same gate the cron loop applies before spending a model call.
       * Chained runs reach the executor a different way, and without this a
       * suspended account or missing key gets a failed run per chained row.
       */
      const blocked = await ownerVerdict(next.userId, verdicts);
      if (blocked) {
        await settleUnrunnable(next.runId, blocked);
        results.push({
          workflowId: "",
          slug: next.slug,
          status: blocked.code,
          runId: next.runId,
        });
        continue;
      }

      try {
        const result = await executeRun(next.runId);
        results.push({
          workflowId: "",
          slug: next.slug,
          status: result.status,
          runId: next.runId,
        });
      } catch (err) {
        // `executeRun` records its own failures, so reaching here means the
        // claim failed. Push on rather than abort — one bad row must not
        // strand every other chained run behind it.
        console.error(`[drain] ${next.slug} failed to start`, err);
        results.push({
          workflowId: "",
          slug: next.slug,
          status: "failed_to_start",
          error: err instanceof Error ? err.message : String(err),
          runId: next.runId,
        });
      }
    }
  }

  /*
   * Deliveries last: a chained run drained above may itself have produced a
   * digest to deliver, and doing this after gives it a shot this same tick
   * instead of waiting five minutes.
   *
   * Swallowed on failure — a retry sweep that throws must not lose the
   * dispatch results this tick already earned.
   */
  try {
    await retryPendingDeliveries(
      () => Date.now() - tickStartedAt <= TICK_BUDGET_MS,
    );
  } catch (err) {
    console.error("[drain] delivery retry sweep failed", err);
  }

  return results;
}

type Unrunnable = { code: string; message: string };

/**
 * Whether this account may spend a model call at all, or null when it may.
 *
 * Cached per sweep: a fanned-out chain is many rows for one owner, and the
 * answer can't change between them.
 */
async function ownerVerdict(
  userId: string | null,
  cache: Map<string, Unrunnable | null>,
): Promise<Unrunnable | null> {
  if (!userId) {
    return { code: "no_owner", message: "this workflow has no owner" };
  }

  const cached = cache.get(userId);
  if (cached !== undefined) return cached;

  const [account] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let verdict: Unrunnable | null = null;
  if (account?.status !== "active") {
    verdict = {
      code: "owner_inactive",
      message: "the account that owns this workflow is not active",
    };
  } else {
    const provider = await getProviderForUser(userId);
    if (!(await hasProviderKey(userId, provider))) {
      verdict = {
        code: "no_provider_key",
        message: `no ${provider} API key is configured — add one and this will run again`,
      };
    }
  }

  cache.set(userId, verdict);
  return verdict;
}

/**
 * Retires a chained row its owner may not run.
 *
 * Written down rather than left queued: the row holds this workflow's slot in
 * the one-active-run index, and skipping it silently means the drain re-reads
 * it every tick until the reaper takes it an hour later.
 */
async function settleUnrunnable(runId: string, verdict: Unrunnable) {
  const now = new Date();
  await db
    .update(runs)
    .set({
      status: "error",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      error: `Chained run not started: ${verdict.message}.`,
      errorCode: verdict.code,
    })
    .where(and(eq(runs.id, runId), eq(runs.status, "queued")));
}

/**
 * Records a workflow that couldn't run for want of a connection.
 *
 * Three things happen, each fixing a distinct failure mode:
 *
 *  - `lastAttemptAt` moves, or the workflow stays due forever.
 *  - A run row is written *at most once a day*, so /runs shows the problem
 *    once instead of 288 identical rows.
 *  - The failure streak advances, and the workflow pauses at the limit.
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
