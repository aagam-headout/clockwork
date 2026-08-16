import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  composioErrorMessage,
  initiateConnection,
  refreshConnectedAccount,
  toolkitExists,
  toolkitIsNoAuth,
} from "@/lib/composio";
import { requireUser } from "@/lib/auth/user";
import {
  beginConnection,
  completeConnection,
  countUserConnections,
  getUserConnection,
} from "@/lib/data/connections";
import { takeToken } from "@/lib/rate-limit";
import { LIMITS } from "@/lib/limits";

// GET so a plain <a href> click can hit it and follow the redirect directly
// — no client JS needed for the core flow.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> },
) {
  // Redirects to sign-in rather than 403: reached by a link click, so a JSON
  // error would dead-end the user.
  const user = await requireUser();
  const { toolkit } = await params;

  // Any Composio toolkit is connectable, not a curated few — the slug is only
  // shape-checked here, then verified against the live catalog.
  if (!/^[a-z0-9_]{2,64}$/.test(toolkit)) {
    return backWithError(req, `Malformed toolkit slug: ${toolkit}`);
  }

  // The Composio API key is app-wide, so one account's connect loop is
  // everyone's problem.
  const gate = await takeToken(user.id, "connect");
  if (!gate.ok) {
    return backWithError(
      req,
      `Too many connection attempts. Try again in ${Math.ceil(gate.retryAfterMs / 1000)}s.`,
    );
  }

  if (!(await toolkitExists(toolkit))) {
    return backWithError(req, `Unknown toolkit: ${toolkit}`);
  }

  // Nothing to connect: Composio answers these tools without a connected
  // account, and asking it for an auth config is a 400 — say so on the page
  // instead of a JSON error.
  if (await toolkitIsNoAuth(toolkit)) {
    return NextResponse.redirect(
      new URL(
        `/connections?notice=${encodeURIComponent(
          `${toolkit} needs no authentication — its tools are already available to every workflow.`,
        )}`,
        req.url,
      ),
    );
  }

  const existing = await getUserConnection(user.id, toolkit);

  // The cap is on breadth, not on repair — reconnecting something you already
  // have is always allowed.
  if (
    !existing &&
    (await countUserConnections(user.id)) >= LIMITS.maxConnectionsPerUser
  ) {
    return backWithError(
      req,
      `You've reached the limit of ${LIMITS.maxConnectionsPerUser} connected apps. Disconnect one first.`,
    );
  }

  /*
   * Repair before replace.
   *
   * `link()` always mints a *new* connected account, so the old reconnect flow
   * left an orphan every time, and Composio picked between them arbitrarily.
   * `refresh()` renews the existing account's credentials instead — cheaper,
   * nothing to clean up. It only works if the provider issued a refresh
   * token, so a failure here is expected and falls through to a full re-link.
   */
  if (existing?.connectedAccountId && existing.status !== "disconnected") {
    try {
      const refreshed = await refreshConnectedAccount(
        existing.connectedAccountId,
      );
      if (String(refreshed.status).toUpperCase() === "ACTIVE") {
        await completeConnection({
          userId: user.id,
          toolkit,
          account: { id: refreshed.id, status: refreshed.status },
        });
        return NextResponse.redirect(
          new URL(
            `/connections?done=${encodeURIComponent(`${toolkit} reconnected.`)}`,
            req.url,
          ),
        );
      }
    } catch {
      // Not refreshable — fall through and re-link.
    }
  }

  /*
   * The nonce ties the callback to this attempt. Without it, the callback URL
   * is a bare GET anyone could replay to promote a pending account.
   */
  const nonce = randomUUID();
  const callbackUrl = new URL(
    `/api/connections/${toolkit}/callback?state=${nonce}`,
    req.url,
  ).toString();

  try {
    const { connectedAccountId, authConfigId, redirectUrl } =
      await initiateConnection(user.id, toolkit, callbackUrl);

    if (!redirectUrl) {
      return backWithError(
        req,
        `Composio did not return a redirect URL for ${toolkit}.`,
      );
    }

    // Recorded as *pending*: any existing live connection keeps working
    // until the callback confirms its replacement, so abandoning the OAuth
    // screen costs nothing.
    await beginConnection({
      userId: user.id,
      toolkit,
      authConfigId,
      pendingAccountId: connectedAccountId,
      nonce,
    });

    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    return backWithError(req, composioErrorMessage(err));
  }
}

/*
 * Reached by a plain link click, so a JSON body would leave the user staring
 * at raw error text with no way back — every failure lands on /connections
 * as an alert instead.
 */
function backWithError(req: NextRequest, message: string) {
  return NextResponse.redirect(
    new URL(`/connections?error=${encodeURIComponent(message)}`, req.url),
  );
}
