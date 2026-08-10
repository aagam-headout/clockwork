import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { LOCAL_AUTH_BYPASS } from "@/lib/auth/local";

// Signed-in gate. Owner-email enforcement (there's exactly one legitimate
// user) happens separately in requireOwner(), called from each protected
// page/action — see src/lib/auth/require-owner.ts for why.
//
// The local Docker stack has no Neon Auth service to sign in against, so the
// gate steps aside there — see src/lib/auth/local.ts for the two locks that
// keep that development-only.
export default LOCAL_AUTH_BYPASS
  ? () => NextResponse.next()
  : auth.middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  matcher: [
    // Everything except: Next internals, the auth UI pages themselves, the
    // Neon Auth API proxy (must stay reachable to sign in at all), the
    // GH Actions cron endpoint, and the Composio trigger webhook (both
    // authenticated by their own secrets — neither has a session cookie).
    "/((?!_next/static|_next/image|favicon.ico|auth|api/auth|api/cron/tick|api/triggers).*)",
  ],
};
