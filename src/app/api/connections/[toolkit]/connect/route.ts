import { NextRequest, NextResponse } from "next/server";
import {
  composioErrorMessage,
  initiateConnection,
  toolkitExists,
  toolkitIsNoAuth,
} from "@/lib/composio";
import { isOwner } from "@/lib/auth/require-owner";

// GET so a plain <a href> / form-less button click can hit it directly and
// follow the redirect — no client JS needed for the core flow.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> },
) {
  // Belt-and-suspenders: middleware already blocks unauthenticated
  // requests, but this only exists to be linked from the (already
  // owner-gated) /connections page — reject anyone else outright.
  if (!(await isOwner())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { toolkit } = await params;

  // Any Composio toolkit is connectable, not just a curated few — so the slug
  // is only shape-checked here and then verified against the live catalog.
  if (!/^[a-z0-9_]{2,64}$/.test(toolkit)) {
    return backWithError(req, `Malformed toolkit slug: ${toolkit}`);
  }

  if (!(await toolkitExists(toolkit))) {
    return backWithError(req, `Unknown toolkit: ${toolkit}`);
  }

  // Nothing to connect: Composio answers these tools without a connected
  // account, and asking it for an auth config is a 400. Say so on the page
  // instead of dead-ending on a JSON error.
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

  const callbackUrl = new URL("/connections", req.url).toString();

  try {
    const { redirectUrl } = await initiateConnection(toolkit, callbackUrl);
    if (!redirectUrl) {
      return backWithError(
        req,
        `Composio did not return a redirect URL for ${toolkit}.`,
      );
    }
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    return backWithError(req, composioErrorMessage(err));
  }
}

/*
 * This route is reached by a plain link click, so a JSON body would leave the
 * user staring at raw error text with no way back. Every failure lands on
 * /connections with the message rendered as an alert instead.
 */
function backWithError(req: NextRequest, message: string) {
  return NextResponse.redirect(
    new URL(`/connections?error=${encodeURIComponent(message)}`, req.url),
  );
}
