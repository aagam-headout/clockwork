import "server-only";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { deleteConnectedAccount, listConnectedAccounts } from "@/lib/composio";
import {
  clearStaleAccounts,
  upsertFromComposio,
  type ComposioAccountSnapshot,
} from "@/lib/data/connections";
import { RECONCILE_BATCH, RECONCILE_TTL_MS } from "@/lib/limits";

/*
 * Connection state lives in Postgres so pages don't have to call Composio to
 * render. Composio is still the source of truth, so something has to close
 * the gap — this is it.
 *
 * Three kinds of drift it catches, none of which produce an event to react
 * to:
 *
 *  - User revoked the grant at the provider (Composio flips the account to
 *    EXPIRED/REVOKED, never tells us).
 *  - An account was deleted in the Composio dashboard.
 *  - An OAuth flow was abandoned, leaving a row stuck in `initiated`.
 */

/** Pulls Composio's view of one user's accounts into our rows. */
export async function reconcileUserConnections(userId: string): Promise<void> {
  const accounts = await listConnectedAccounts(userId);

  const snapshots: ComposioAccountSnapshot[] = accounts
    .map((acc) => ({
      id: acc.id,
      toolkitSlug: acc.toolkit?.slug ?? "",
      status: acc.status,
      statusReason: null,
    }))
    .filter((a) => a.toolkitSlug);

  await upsertFromComposio(userId, snapshots);
  await retryStaleDeletes(userId);
}

/**
 * Retries the deletes that the connect callback couldn't confirm.
 *
 * A superseded account left behind at Composio isn't harmful, but it keeps
 * appearing in `list()`, making the reconcile above see two accounts for one
 * toolkit.
 */
async function retryStaleDeletes(userId: string): Promise<void> {
  const rows = await db
    .select({
      toolkit: connections.toolkit,
      staleAccountIds: connections.staleAccountIds,
    })
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        sql`array_length(${connections.staleAccountIds}, 1) > 0`,
      ),
    );

  for (const row of rows) {
    const cleared: string[] = [];
    for (const accountId of row.staleAccountIds) {
      try {
        await deleteConnectedAccount(accountId);
        cleared.push(accountId);
      } catch {
        // Already gone, or Composio is refusing. Either way the next sweep
        // tries again; a stale id is cheap to carry.
      }
    }
    if (cleared.length > 0) {
      await clearStaleAccounts(userId, row.toolkit, cleared);
    }
  }
}

/**
 * Reconciles one user, but only if their rows are stale.
 *
 * For the opportunistic refresh on /connections. The staleness decision lives
 * here, not at the call site, so the page renders from the database with no
 * clock reading of its own — and the check happens after the response is
 * already sent.
 */
export async function reconcileUserIfStale(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - PAGE_REFRESH_AFTER_MS);

  const [stale] = await db
    .select({ toolkit: connections.toolkit })
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        or(
          sql`${connections.lastCheckedAt} is null`,
          lt(connections.lastCheckedAt, cutoff),
        ),
      ),
    )
    .limit(1);

  if (!stale) return false;
  await reconcileUserConnections(userId);
  return true;
}

/** How stale a connection row may be before a page visit refreshes it. */
const PAGE_REFRESH_AFTER_MS = 10 * 60 * 1000;

/**
 * The cron-tick sweep: reconciles only users with something worth re-reading.
 *
 * Bounded per tick so a growing user base can't eat the tick's time budget,
 * ordered by `lastCheckedAt` so the bound behaves as round-robin rather than
 * starving the same users.
 */
export async function reconcileStaleConnections(
  limit = RECONCILE_BATCH,
): Promise<number> {
  const staleBefore = new Date(Date.now() - RECONCILE_TTL_MS);
  const abandonedBefore = new Date(Date.now() - 10 * 60 * 1000);

  const rows = await db
    .select({ userId: connections.userId })
    .from(connections)
    .where(
      and(
        isNotNull(connections.userId),
        or(
          lt(connections.lastCheckedAt, staleBefore),
          sql`${connections.lastCheckedAt} is null`,
          and(
            eq(connections.status, "initiated"),
            lt(connections.pendingStartedAt, abandonedBefore),
          ),
          sql`array_length(${connections.staleAccountIds}, 1) > 0`,
        ),
      ),
    )
    .groupBy(connections.userId)
    .orderBy(sql`min(${connections.lastCheckedAt}) nulls first`)
    .limit(limit);

  let done = 0;
  for (const row of rows) {
    if (!row.userId) continue;
    try {
      await reconcileUserConnections(row.userId);
      done++;
    } catch (err) {
      // One user's Composio failure must not stop the sweep — or the tick.
      console.error("[reconcile] failed for user", row.userId, err);
    }
  }
  return done;
}
