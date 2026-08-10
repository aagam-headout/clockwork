import { CronExpressionParser } from "cron-parser";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";

/**
 * A workflow is "due" if its most recent scheduled fire time (per its own
 * cron + timezone) is after `lastRunAt` — i.e. at least one tick has passed
 * since it last ran. Tick cadence (GH Actions, every 5 min) is the real
 * schedule resolution; the cron expression only has to be coarser than that.
 */
function isDue(
  cron: string,
  timezone: string,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: now,
    tz: timezone,
  });
  const mostRecentFire = interval.prev().toDate();
  if (!lastRunAt) return true;
  return mostRecentFire > lastRunAt;
}

export async function runDueWorkflows(now: Date = new Date()) {
  const enabled = await db
    .select()
    .from(workflows)
    .where(eq(workflows.enabled, true));

  const results: Array<{
    workflowId: string;
    slug: string;
    status: string;
    error?: string;
  }> = [];

  for (const workflow of enabled) {
    let due: boolean;
    try {
      due = isDue(workflow.cron, workflow.timezone, workflow.lastRunAt, now);
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

    // Sequential on purpose: a shared Vercel function has one duration
    // budget (maxDuration) to split across every due workflow in this
    // tick, and sequential execution keeps failures isolated and simple
    // to reason about. Revisit if the due-count per tick grows.
    const result = await runWorkflow(workflow, "cron");
    results.push({ workflowId: workflow.id, slug: workflow.slug, ...result });
  }

  return results;
}
