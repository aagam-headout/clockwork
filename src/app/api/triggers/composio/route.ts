import { NextResponse, after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { composio } from "@/lib/composio";
import { enqueueRun, executeRun } from "@/lib/executor";

export const maxDuration = 300;

/**
 * Composio trigger ingress. One project-wide webhook carries every trigger
 * event; this fans each one out to the enabled event workflows that
 * subscribed to that slug.
 *
 * The signature is verified against COMPOSIO_WEBHOOK_SECRET — this endpoint
 * is public, and an unverified body would let anyone start runs (and spend
 * model budget) at will.
 */
export async function POST(request: Request) {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "COMPOSIO_WEBHOOK_SECRET is not configured" },
      { status: 503 },
    );
  }

  let event;
  try {
    const result = await composio.triggers.parse(request, {
      verifySecret: secret,
    });
    event = result.payload;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const matches = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.enabled, true),
        eq(workflows.triggerType, "event"),
        sql`${workflows.eventTriggers} @> ARRAY[${event.triggerSlug}]::text[]`,
      ),
    );

  const started: Array<{
    workflowId: string;
    runId: string | null;
    status: string;
  }> = [];

  for (const workflow of matches) {
    // The event id doubles as the dedupe key: Composio retries webhooks, and
    // the `runs_trigger_ref_unique` index turns a retry into a no-op.
    const queued = await enqueueRun(workflow.id, "event", {
      triggerRef: `${workflow.id}:${event.id}`,
      triggerPayload: { slug: event.triggerSlug, data: event.payload },
    });

    if (queued.skipped) {
      started.push({
        workflowId: workflow.id,
        runId: null,
        status: queued.reason,
      });
      continue;
    }

    const runId = queued.runId;
    after(() => executeRun(runId));
    started.push({ workflowId: workflow.id, runId, status: "queued" });
  }

  return NextResponse.json({ trigger: event.triggerSlug, started });
}
