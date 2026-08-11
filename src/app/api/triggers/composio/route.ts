import { NextResponse, after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, workflows } from "@/db/schema";
import { composio, appUserIdFromComposio } from "@/lib/composio";
import { userIdForConnectedAccount } from "@/lib/data/connections";
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

  /*
   * Whose event is this?
   *
   * The payload carries the Composio user id the trigger fired for, and
   * `metadata.connectedAccount` as a second source. Both are mapped back
   * through the namespace this app derives its Composio ids with; anything
   * that doesn't map — an event from another deploy sharing the API key, or an
   * account linked before the namespace existed — falls back to a lookup on
   * the connected account id.
   */
  const meta = (event as { metadata?: { connectedAccount?: { id?: string } } })
    .metadata;
  const rawUserId = (event as { userId?: string }).userId ?? null;

  let ownerId = rawUserId ? appUserIdFromComposio(rawUserId) : null;
  if (!ownerId && meta?.connectedAccount?.id) {
    ownerId = await userIdForConnectedAccount(meta.connectedAccount.id);
  }

  /*
   * Fail closed. The previous behaviour — fan out to every enabled workflow
   * subscribed to this slug — was harmless with one user and is a cross-tenant
   * run trigger with two: one person's new Slack message would start another
   * person's workflow, spending their model budget on their data.
   *
   * 202 rather than a 4xx so Composio treats it as delivered and doesn't
   * retry-storm an event that will never be routable.
   */
  if (!ownerId) {
    console.warn("[triggers] unmapped composio user", {
      rawUserId,
      slug: event.triggerSlug,
    });
    return NextResponse.json({ skipped: "unmapped_user" }, { status: 202 });
  }

  const [owner] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);

  if (!owner || owner.status !== "active") {
    return NextResponse.json({ skipped: "inactive_user" }, { status: 202 });
  }

  const matches = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, ownerId),
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
