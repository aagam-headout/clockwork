import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";
import { LOCAL_AUTH_BYPASS } from "@/lib/auth/local";

// Signed-in gate. Owner-email enforcement (there's exactly one legitimate
// user) happens separately in requireOwner(), called from each protected
// page/action — see src/lib/auth/require-owner.ts for why.
//
// The local Docker stack has no Neon Auth service to sign in against, so the
// gate steps aside there — see src/lib/auth/local.ts for the two locks that
// keep that development-only.
const gate = auth.middleware({ loginUrl: "/auth/sign-in" });

/*
 * `fetch()` follows a 307 transparently, so an expired session turned every
 * client-side POST (e.g. /api/workflows/propose) into a POST at the sign-in
 * page and then a JSON parse failure on an HTML body — the browser reported
 * only the redirect. API routes get a 401 they can actually report instead;
 * page navigations keep the redirect, which is the right answer for them.
 */
export default async function proxy(req: NextRequest, event: unknown) {
  if (LOCAL_AUTH_BYPASS) return NextResponse.next();

  const res = await (
    gate as (req: NextRequest, event: unknown) => Promise<Response> | Response
  )(req, event);

  const redirectedToSignIn =
    res.status >= 300 &&
    res.status < 400 &&
    (res.headers.get("location") ?? "").includes("/auth/sign-in");

  if (redirectedToSignIn && req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in — reload the page and sign in again." },
      { status: 401 },
    );
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except: Next internals, the auth UI pages themselves, the
    // Neon Auth API proxy (must stay reachable to sign in at all), the
    // GH Actions cron endpoint, and the Composio trigger webhook (both
    // authenticated by their own secrets — neither has a session cookie).
    "/((?!_next/static|_next/image|favicon.ico|auth|api/auth|api/cron/tick|api/triggers).*)",
  ],
};
