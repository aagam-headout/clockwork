import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { connections, workflows } from "@/db/schema";
import type { DeliverTarget } from "@/lib/read-only";

/**
 * Connection state as the app talks about it.
 *
 * These are our words, not Composio's. Composio has seven statuses
 * (INITIALIZING, INITIATED, ACTIVE, FAILED, EXPIRED, INACTIVE, REVOKED), and
 * the previous code collapsed six of them into "invisible" by filtering on
 * `!== ACTIVE`. Keeping them distinct lets the UI say *why* a toolkit needs
 * attention instead of silently dropping it.
 */
export type ConnectionStatus =
  | "active"
  | "initiated"
  | "expired"
  | "failed"
  | "revoked"
  | "inactive"
  | "disconnected";

export type UserConnection = {
  toolkit: string;
  status: ConnectionStatus;
  statusReason: string | null;
  connectedAccountId: string | null;
  pendingAccountId: string | null;
  pendingNonce: string | null;
  staleAccountIds: string[];
  connectedAt: Date | null;
  /** Usable for a run right now. */
  usable: boolean;
  /** Connected at some point, but currently broken — offer a reconnect. */
  needsAttention: boolean;
};

/**
 * What each status is called on screen. The stored slugs used to render
 * straight into status chips — "initiated" and "inactive" are Composio's
 * vocabulary, and side by side nobody can tell which means "nearly there"
 * vs. "broken".
 */
export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  active: "Connected",
  initiated: "Finishing",
  expired: "Expired",
  failed: "Failed",
  revoked: "Revoked",
  inactive: "Inactive",
  disconnected: "Disconnected",
};

const ACTIVE: ConnectionStatus = "active";

function mapComposioStatus(
  status: string | null | undefined,
): ConnectionStatus {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "INITIALIZING":
    case "INITIATED":
      return "initiated";
    case "EXPIRED":
      return "expired";
    case "FAILED":
      return "failed";
    case "REVOKED":
      return "revoked";
    case "INACTIVE":
      return "inactive";
    default:
      return "failed";
  }
}

type ConnectionRow = typeof connections.$inferSelect;

function toUserConnection(row: ConnectionRow): UserConnection {
  const status = row.status as ConnectionStatus;
  return {
    toolkit: row.toolkit,
    status,
    statusReason: row.statusReason,
    connectedAccountId: row.composioConnectedAccountId,
    pendingAccountId: row.pendingAccountId,
    pendingNonce: row.pendingNonce,
    staleAccountIds: row.staleAccountIds ?? [],
    connectedAt: row.connectedAt,
    usable: status === ACTIVE,
    needsAttention:
      status === "expired" ||
      status === "failed" ||
      status === "revoked" ||
      status === "inactive",
  };
}

export async function getUserConnections(
  userId: string,
): Promise<UserConnection[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId));
  return rows.map(toUserConnection);
}

export async function getUserConnection(
  userId: string,
  toolkit: string,
): Promise<UserConnection | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(eq(connections.userId, userId), eq(connections.toolkit, toolkit)),
    )
    .limit(1);
  return row ? toUserConnection(row) : null;
}

/**
 * Toolkits this user can actually use right now — the input to the run
 * preflight and to the workflow form's validation.
 */
export async function activeToolkitSlugs(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ toolkit: connections.toolkit })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.status, ACTIVE)));
  return new Set(rows.map((r) => r.toolkit));
}

/** Same, for every user at once — one query per cron tick instead of per workflow. */
export async function activeToolkitsByUser(
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const byUser = new Map<string, Set<string>>();
  if (userIds.length === 0) return byUser;

  const rows = await db
    .select({ userId: connections.userId, toolkit: connections.toolkit })
    .from(connections)
    .where(
      and(inArray(connections.userId, userIds), eq(connections.status, ACTIVE)),
    );

  for (const row of rows) {
    if (!row.userId) continue;
    const set = byUser.get(row.userId) ?? new Set<string>();
    set.add(row.toolkit);
    byUser.set(row.userId, set);
  }
  return byUser;
}

export async function countUserConnections(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        sql`${connections.status} <> 'disconnected'`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * Maps a Composio connected account back to its owner.
 *
 * The trigger webhook's fallback path, for accounts linked before the user
 * namespace existed, or whose payload has no user id.
 */
export async function userIdForConnectedAccount(
  connectedAccountId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: connections.userId })
    .from(connections)
    .where(eq(connections.composioConnectedAccountId, connectedAccountId))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Records the start of a connect or reconnect.
 *
 * Deliberately leaves `composioConnectedAccountId` alone: a user who opens
 * the OAuth page and closes the tab keeps whatever connection they had.
 * Only the callback promotes the pending account.
 */
export async function beginConnection(args: {
  userId: string;
  toolkit: string;
  authConfigId: string;
  pendingAccountId: string;
  nonce: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(connections)
    .values({
      userId: args.userId,
      toolkit: args.toolkit,
      authConfigId: args.authConfigId,
      pendingAccountId: args.pendingAccountId,
      pendingNonce: args.nonce,
      pendingStartedAt: now,
      status: "initiated",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connections.userId, connections.toolkit],
      set: {
        authConfigId: args.authConfigId,
        pendingAccountId: args.pendingAccountId,
        pendingNonce: args.nonce,
        pendingStartedAt: now,
        updatedAt: now,
        /*
         * Only a row with no working account moves to "initiated" — a live
         * connection being repaired stays "active" until the new account is
         * confirmed, so an abandoned reconnect can't take it offline.
         */
        status: sql`case when ${connections.composioConnectedAccountId} is null
                    then 'initiated' else ${connections.status} end`,
      },
    });
}

/**
 * Promotes the pending account to the live one.
 *
 * Returns the account it superseded, if any, so the caller can delete it at
 * Composio — after the new one is confirmed active, never before.
 */
export async function completeConnection(args: {
  userId: string;
  toolkit: string;
  account: { id: string; status?: string | null; statusReason?: string | null };
}): Promise<{ supersededAccountId: string | null }> {
  const now = new Date();
  const status = mapComposioStatus(args.account.status ?? "ACTIVE");

  const [before] = await db
    .select({ current: connections.composioConnectedAccountId })
    .from(connections)
    .where(
      and(
        eq(connections.userId, args.userId),
        eq(connections.toolkit, args.toolkit),
      ),
    )
    .limit(1);

  const superseded =
    before?.current && before.current !== args.account.id
      ? before.current
      : null;

  await db
    .update(connections)
    .set({
      composioConnectedAccountId: args.account.id,
      status,
      statusReason: args.account.statusReason ?? null,
      staleAccountIds: superseded
        ? sql`array_append(${connections.staleAccountIds}, ${superseded})`
        : undefined,
      pendingAccountId: null,
      pendingNonce: null,
      pendingStartedAt: null,
      connectedAt: status === ACTIVE ? now : null,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(connections.userId, args.userId),
        eq(connections.toolkit, args.toolkit),
      ),
    );

  return { supersededAccountId: superseded };
}

/** Drops ids from `staleAccountIds` once they're confirmed gone at Composio. */
export async function clearStaleAccounts(
  userId: string,
  toolkit: string,
  accountIds: string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  await db
    .update(connections)
    .set({
      staleAccountIds: sql`(
        select coalesce(array_agg(x), '{}')
        from unnest(${connections.staleAccountIds}) as x
        where x <> all(${accountIds})
      )`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(connections.userId, userId), eq(connections.toolkit, toolkit)),
    );
}

export async function markConnectionStatus(
  userId: string,
  toolkit: string,
  status: ConnectionStatus,
  reason?: string | null,
): Promise<void> {
  await db
    .update(connections)
    .set({
      status,
      statusReason: reason ?? null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(connections.userId, userId), eq(connections.toolkit, toolkit)),
    );
}

export async function markDisconnected(
  userId: string,
  toolkit: string,
): Promise<void> {
  await db
    .update(connections)
    .set({
      status: "disconnected",
      statusReason: null,
      composioConnectedAccountId: null,
      pendingAccountId: null,
      pendingNonce: null,
      pendingStartedAt: null,
      staleAccountIds: [],
      connectedAt: null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(connections.userId, userId), eq(connections.toolkit, toolkit)),
    );
}

/** A Composio account as the reconcile job sees it. */
export type ComposioAccountSnapshot = {
  id: string;
  toolkitSlug: string;
  status?: string | null;
  statusReason?: string | null;
};

/**
 * Pulls Composio's view of one user's accounts into our rows.
 *
 * The part that matters: a row whose account no longer appears in Composio's
 * list is marked disconnected. Without it, an account deleted in the Composio
 * dashboard would stay "active" here forever, and every run would fail at
 * the tool call instead of the preflight.
 */
export async function upsertFromComposio(
  userId: string,
  accounts: ComposioAccountSnapshot[],
): Promise<void> {
  const now = new Date();
  const seen = new Set<string>();

  for (const account of accounts) {
    const toolkit = account.toolkitSlug;
    if (!toolkit) continue;
    seen.add(toolkit);

    await db
      .insert(connections)
      .values({
        userId,
        toolkit,
        composioConnectedAccountId: account.id,
        status: mapComposioStatus(account.status),
        statusReason: account.statusReason ?? null,
        connectedAt: mapComposioStatus(account.status) === ACTIVE ? now : null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [connections.userId, connections.toolkit],
        set: {
          composioConnectedAccountId: account.id,
          status: mapComposioStatus(account.status),
          statusReason: account.statusReason ?? null,
          lastCheckedAt: now,
          updatedAt: now,
        },
      });
  }

  const stale = await db
    .select({ toolkit: connections.toolkit })
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        sql`${connections.status} <> 'disconnected'`,
      ),
    );

  const vanished = stale
    .map((r) => r.toolkit)
    .filter((toolkit) => !seen.has(toolkit));

  if (vanished.length > 0) {
    await db
      .update(connections)
      .set({
        status: "disconnected",
        statusReason: "no longer present at Composio",
        composioConnectedAccountId: null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(connections.userId, userId),
          inArray(connections.toolkit, vanished),
        ),
      );
  } else {
    await db
      .update(connections)
      .set({ lastCheckedAt: now })
      .where(eq(connections.userId, userId));
  }
}

/**
 * The user's workflows that depend on a toolkit.
 *
 * Delivery targets count: a workflow with Slack DM delivery needs Slack even
 * if `slack` isn't in its `toolkits` array — `deliverToolkits()` adds it at
 * run time. Disconnecting Slack breaks that workflow just as surely as one
 * that reads from Slack, so the dependency warning must see both.
 */
export async function workflowsUsingToolkit(userId: string, toolkit: string) {
  const deliverMatches =
    toolkit === "slack"
      ? sql`(${workflows.deliver}::jsonb @> '[{"type":"slack_dm"}]'::jsonb
             or ${workflows.deliver}::jsonb @> '[{"type":"slack_channel"}]'::jsonb)`
      : toolkit === "gmail"
        ? sql`${workflows.deliver}::jsonb @> '[{"type":"email"}]'::jsonb`
        : sql`false`;

  return db
    .select({
      id: workflows.id,
      name: workflows.name,
      enabled: workflows.enabled,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, userId),
        or(
          sql`${workflows.toolkits} @> ARRAY[${toolkit}]::text[]`,
          deliverMatches,
        ),
      ),
    );
}

/**
 * How many of the user's workflows depend on each toolkit, in one query.
 *
 * The per-toolkit version above is fine for a single disconnect; the
 * connections page needs the count on every card at once, and asking per
 * card would be one query per connected app on every render.
 */
export async function dependentCountsByToolkit(
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ toolkits: workflows.toolkits, deliver: workflows.deliver })
    .from(workflows)
    .where(eq(workflows.userId, userId));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const needed = new Set<string>(row.toolkits);
    for (const target of (row.deliver ?? []) as DeliverTarget[]) {
      const slug = DELIVER_TOOLKITS[target.type];
      if (slug) needed.add(slug);
    }
    for (const slug of needed) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return counts;
}

/** Toolkits a delivery target needs a connection for. */
export const DELIVER_TOOLKITS: Partial<Record<DeliverTarget["type"], string>> =
  {
    slack_dm: "slack",
    slack_channel: "slack",
    email: "gmail",
  };
