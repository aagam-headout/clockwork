import { createNeonAuth } from "@neondatabase/auth/next/server";
import { resolveBaseUrl } from "@/lib/base-url";

// Single entry point for all server-side auth: API handler, middleware, and
// getSession() in server components/actions all go through this instance.
export const auth = createNeonAuth({
  baseUrl: resolveBaseUrl(process.env.NEON_AUTH_BASE_URL)!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    /*
     * @neondatabase/auth defaults these cookies to SameSite=Strict, which the
     * browser withholds on *any* cross-site navigation into the app — including
     * the one that ends every OAuth flow. Composio sends the user to the
     * provider, the provider redirects back to
     * /api/connections/[toolkit]/callback, and with Strict that request arrives
     * with no session: the proxy gate reads it as signed-out and, because the
     * path is under /api/, answers the raw JSON "Not signed in" instead of
     * completing the connection.
     *
     * Lax still withholds the cookie on cross-site POSTs — the CSRF case Strict
     * exists for — while allowing the top-level GET navigation the callback is.
     */
    sameSite: "lax",
  },
});
