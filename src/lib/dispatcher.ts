import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";
import { isDue } from "@/lib/schedule";

/**
 * How long one tick may spend starting runs. The route's `maxDuration` is
 * 300s and a single run may take up to 240s, so the dispatcher stops handing
 * out work well before the function is killed — anything left over is still
 * due on the next tick, because `lastAttemptAt` only moves for workflows that
 * actually started.
 */
const TICK_BUDGET_MS = 240_000;

export async function runDueWorkflows(now: Date = new Date()) {
  const enabled = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.enabled, true), eq(workflows.triggerType, "cron")));

  const results: Array<{
    workflowId: string;
    slug: string;
    status: string;
    error?: string;
  }> = [];

  const tickStartedAt = Date.now();

  for (const workflow of enabled) {
    let due: boolean;
    try {
      due = isDue(
        workflow.cron,
        workflow.timezone,
        workflow.lastAttemptAt,
        now,
      );
    } catch (err) {
      results.push({
        workflowId: workflow.id,
        slug: workflow.slug,
        status: "invalid_cron",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!due) continue;

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
    const result = await runWorkflow(workflow, "cron");
    results.push({ workflowId: workflow.id, slug: workflow.slug, ...result });
  }

  return results;
}
