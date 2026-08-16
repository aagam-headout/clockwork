import { composio, composioErrorMessage } from "./client";
import { composioUserId } from "./identity";

/**
 * Finds an existing Composio-managed auth config for a toolkit, or creates
 * one. `link()` (not the deprecated `initiate()`) handles the actual OAuth
 * redirect — see https://docs.composio.dev/docs/changelog/2026/04/24.
 *
 * Auth configs are app-wide, not per user: one Composio-managed config per
 * toolkit serves everybody, and the per-user part is the connected account
 * created against it.
 *
 * The in-flight map dedupes the burst when several users connect the same new
 * toolkit at once — without it, concurrent `list()` calls all miss and all
 * create. Duplicates aren't fatal (Composio allows several configs per
 * toolkit and `list()[0]` converges), so this is best-effort.
 */
const inFlightAuthConfigs = new Map<string, Promise<string>>();

export async function getOrCreateAuthConfigId(
  toolkit: string,
): Promise<string> {
  const existing = inFlightAuthConfigs.get(toolkit);
  if (existing) return existing;

  const pending = (async () => {
    const found = await composio.authConfigs.list({ toolkit });
    if (found.items[0]?.id) return found.items[0].id;

    const created = await composio.authConfigs.create(toolkit, {
      type: "use_composio_managed_auth",
      name: `${toolkit} (Clockwork)`,
    });
    return created.id;
  })().finally(() => inFlightAuthConfigs.delete(toolkit));

  inFlightAuthConfigs.set(toolkit, pending);
  return pending;
}

/**
 * Starts a connection for `toolkit` on behalf of one user, and returns the URL
 * to redirect the browser to. Composio redirects back to `callbackUrl` once
 * the user finishes OAuth on their hosted page.
 *
 * `allowMultiple` is required because `link()` otherwise refuses when the
 * user already has an active account for this auth config. The connect
 * route's reconnect path tries `refreshConnectedAccount` first precisely so
 * this — which does mint a second account — is the fallback, and the
 * superseded account is deleted once the new one is live.
 */
export async function initiateConnection(
  userId: string,
  toolkit: string,
  callbackUrl: string,
) {
  const authConfigId = await getOrCreateAuthConfigId(toolkit);
  const connectionRequest = await composio.connectedAccounts.link(
    composioUserId(userId),
    authConfigId,
    { callbackUrl, allowMultiple: true },
  );
  return {
    connectedAccountId: connectionRequest.id,
    authConfigId,
    redirectUrl: connectionRequest.redirectUrl,
  };
}

/**
 * Every connected account for one user.
 *
 * Pages through `nextCursor`: the per-user cap keeps this to a single page in
 * practice, but the reconcile job needs *all* accounts to decide which of our
 * rows no longer exist — a truncated list there would mark live connections
 * as disconnected.
 */
export async function listConnectedAccounts(userId: string) {
  const items: Awaited<
    ReturnType<typeof composio.connectedAccounts.list>
  >["items"] = [];

  let cursor: string | undefined;
  do {
    const res = await composio.connectedAccounts.list({
      userIds: [composioUserId(userId)],
      ...(cursor ? { cursor } : {}),
    });
    items.push(...res.items);
    cursor = res.nextCursor ?? undefined;
  } while (cursor);

  return items;
}

export async function getConnectedAccount(connectedAccountId: string) {
  return composio.connectedAccounts.get(connectedAccountId);
}

/**
 * Refreshes an existing account's credentials in place.
 *
 * The only repair path that doesn't create a second connected account, so the
 * connect route tries it before re-linking. Only helps OAuth flows that
 * issued a refresh token — a fully revoked grant still needs a new account —
 * so callers must be ready for it to throw.
 */
export async function refreshConnectedAccount(connectedAccountId: string) {
  return composio.connectedAccounts.refresh(connectedAccountId);
}

/**
 * Polls until the account is ACTIVE.
 *
 * The SDK's default 60s wait is far too long to hold a request handler open;
 * callers pass tens of seconds and let the reconcile job finish anything
 * slower. Throws on FAILED/EXPIRED/REVOKED and on timeout — two cases the
 * caller must tell apart, since a timeout is not a failure.
 */
export async function waitForActiveAccount(
  connectedAccountId: string,
  timeoutMs: number,
) {
  return composio.connectedAccounts.waitForConnection(
    connectedAccountId,
    timeoutMs,
  );
}

export async function deleteConnectedAccount(connectedAccountId: string) {
  try {
    await composio.connectedAccounts.delete(connectedAccountId);
  } catch (err) {
    // The SDK's `message` on an HTTP failure is just the status code ("403");
    // everything actionable — including the "grant write access to this key"
    // hint — sits in the response body hung off the error.
    throw new Error(composioErrorMessage(err));
  }
}
