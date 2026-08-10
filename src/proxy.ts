import { auth } from "@/lib/auth/server";

// Signed-in gate. Owner-email enforcement (there's exactly one legitimate
// user) happens separately in requireOwner(), called from each protected
// page/action — see src/lib/auth/require-owner.ts for why.
export default auth.middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  matcher: [
    // Everything except: Next internals, the auth UI pages themselves, the
    // Neon Auth API proxy (must stay reachable to sign in at all), and the
    // GH Actions cron endpoint (authenticated by its own bearer secret —
    // GH Actions has no session cookie to send).
    "/((?!_next/static|_next/image|favicon.ico|auth|api/auth|api/cron/tick).*)",
  ],
};
