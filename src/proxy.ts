import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { LOCAL_AUTH_BYPASS } from "@/lib/auth/local";

// Signed-in gate, nothing more. *Which* rows a signed-in user may see is
// decided per query by the scoped accessors in src/lib/data/scope.ts;
// account status is enforced in requireUser() — see src/lib/auth/user.ts.
//
// The local Docker stack has no Neon Auth service to sign in against, so the
// gate steps aside there — see src/lib/auth/local.ts for the two locks that
// keep that development-only.
const gate = auth.middleware({ loginUrl: "/auth/sign-in" });

type Gate = (req: NextRequest, event: unknown) => Promise<Response> | Response;

export default async function proxy(req: NextRequest, event: unknown) {
  if (LOCAL_AUTH_BYPASS) return NextResponse.next();

  /*
   * @neondatabase/auth 0.4.2-beta proxies the incoming request's *method*
   * through to its upstream `get-session` endpoint, which only answers GET.
   * So every POST — every server action, every fetch to an API route — got a
   * 404, read as "not signed in", and got bounced to the sign-in page:
   * saving a workflow died with Next's generic "This page couldn't load,"
   * and POST /api/workflows/propose 307'd.
   *
   * The gate only reads cookies off the request, so it's handed a GET with
   * the same URL and headers, and its verdict is applied to the real one.
   */
  const probe =
    req.method === "GET" || req.method === "HEAD"
      ? req
      : new NextRequest(req.url, { headers: req.headers });

  const res = await (gate as Gate)(probe, event);

  const bouncedToSignIn =
    res.status >= 300 &&
    res.status < 400 &&
    (res.headers.get("location") ?? "").includes("/auth/sign-in");

  // `fetch` follows a redirect transparently, so an expired session reached
  // the client as a JSON parse failure on the sign-in page's HTML. API
  // routes get a status they can report instead.
  if (bouncedToSignIn && req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in — reload the page and sign in again." },
      { status: 401 },
    );
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except: Next internals, the auth UI pages, the Neon Auth
    // API proxy (must stay reachable to sign in at all), the GH Actions cron
    // endpoint, and the Composio trigger webhook (both authenticated by
    // their own secrets — neither has a session cookie).
    //
    // Exemptions are anchored with `(?:/|$)`. Unanchored, `api/triggers`
    // would also exempt a future `/api/triggers-admin`, reachable with no
    // session at all. Non-capturing: Next rejects a matcher with capturing
    // groups.
    "/((?!_next/static|_next/image|favicon.ico|auth(?:/|$)|api/auth(?:/|$)|api/cron/tick(?:/|$)|api/triggers(?:/|$)).*)",
  ],
};
