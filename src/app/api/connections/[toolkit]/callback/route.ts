import { NextRequest, NextResponse, after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import {
  composioErrorMessage,
  deleteConnectedAccount,
  waitForActiveAccount,
} from "@/lib/composio";
import { requireUser } from "@/lib/auth/user";
import {
  clearStaleAccounts,
  completeConnection,
  getUserConnection,
  markConnectionStatus,
  workflowsUsingToolkit,
} from "@/lib/data/connections";
import { syncEventTriggers } from "@/lib/triggers";
import { activeToolkitSlugs } from "@/lib/data/connections";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { CONNECT_WAIT_MS } from "@/lib/limits";

/**
 * Where Composio sends the browser after OAuth.
 *
 * Previously there was no such route: Composio redirected straight to
 * /connections, which re-rendered whatever state was there — usually still
 * "pending", with no way to tell a completed connection from an abandoned
 * one. Confirming the handshake here is what makes "connected" mean connected.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> },
) {
  const user = await requireUser();
  const { toolkit } = await params;
  const label = TOOLKIT_LABELS[toolkit] ?? toolkit;
  const nonce = req.nextUrl.searchParams.get("state") ?? "";

  const conn = await getUserConnection(user.id, toolkit);

  // Replay, or a callback for a connect that was superseded by a later one.
  if (
    !conn?.pendingAccountId ||
    !conn.pendingNonce ||
    conn.pendingNonce !== nonce
  ) {
    return back(
      req,
      "error",
      "That connection link was already used or has expired.",
    );
  }

  let account;
  try {
    /*
     * The callback fires on redirect, not token exchange, so the account is
     * usually — not always — already ACTIVE by now. A short poll covers the
     * gap; anything slower is left to the reconcile job rather than holding
     * the request open for the SDK's 60-second default.
     */
    account = await waitForActiveAccount(
      conn.pendingAccountId,
      CONNECT_WAIT_MS,
    );
  } catch (err) {
    const message = composioErrorMessage(err);

    // A timeout isn't a failure — the handshake may still complete. Leaving
    // the row `initiated` lets the reconcile sweep finish it; calling it
    // "failed" here would be a lie the user acts on.
    if (/timeout|timed out/i.test(message)) {
      return back(
        req,
        "notice",
        `${label} is still finishing authorisation. Refresh this page in a few seconds.`,
      );
    }

    await markConnectionStatus(user.id, toolkit, "failed", message);
    return back(req, "error", `${label} could not be connected: ${message}`);
  }

  const { supersededAccountId } = await completeConnection({
    userId: user.id,
    toolkit,
    account: { id: account.id, status: account.status },
  });

  /*
   * Only now is the old account dead weight — deleting it before the new one
   * was confirmed would leave the user with nothing if the handshake failed.
   * A failure here is fine: the id stays in `staleAccountIds` and reconcile
   * retries.
   */
  if (supersededAccountId) {
    after(async () => {
      try {
        await deleteConnectedAccount(supersededAccountId);
        await clearStaleAccounts(user.id, toolkit, [supersededAccountId]);
      } catch (err) {
        console.error("[connections] stale account cleanup deferred", err);
      }
    });
  }

  after(async () => {
    try {
      await resumeWorkflowsBlockedOn(user.id, toolkit);
      // Triggers couldn't register while the toolkit was down, and any that
      // did are pinned to the account we just replaced.
      await syncEventTriggers(user.id);
    } catch (err) {
      console.error("[connections] post-connect sync failed", err);
    }
  });

  return back(req, "done", `${label} connected.`);
}

/**
 * Re-enables workflows this toolkit's absence had paused.
 *
 * Scoped to `pausedReason = 'needs_reconnect'`, so it only undoes an
 * automatic pause — a deliberately paused workflow stays paused. A workflow
 * needing two apps only resumes once *both* are healthy.
 */
async function resumeWorkflowsBlockedOn(userId: string, toolkit: string) {
  const dependents = await workflowsUsingToolkit(userId, toolkit);
  const paused = dependents.filter((w) => !w.enabled);
  if (paused.length === 0) return;

  const active = await activeToolkitSlugs(userId);

  const rows = await db
    .select({
      id: workflows.id,
      toolkits: workflows.toolkits,
      pausedReason: workflows.pausedReason,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, userId),
        inArray(
          workflows.id,
          paused.map((w) => w.id),
        ),
      ),
    );

  const ready = rows
    .filter((row) => row.pausedReason === "needs_reconnect")
    .filter((row) =>
      row.toolkits.every(
        (slug) => slug === "composio_search" || active.has(slug),
      ),
    )
    .map((row) => row.id);

  if (ready.length === 0) return;

  await db
    .update(workflows)
    .set({
      enabled: true,
      pausedReason: null,
      connectionFailures: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(workflows.userId, userId), inArray(workflows.id, ready)));
}

function back(
  req: NextRequest,
  key: "done" | "error" | "notice",
  message: string,
) {
  return NextResponse.redirect(
    new URL(`/connections?${key}=${encodeURIComponent(message)}`, req.url),
  );
}
