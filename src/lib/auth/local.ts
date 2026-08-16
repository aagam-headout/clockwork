/**
 * Local-only auth bypass.
 *
 * Neon Auth is hosted, so the Docker stack can't run it like Postgres. Rather
 * than make every local session depend on a cloud login, `LOCAL_AUTH_BYPASS=true`
 * treats the single local user as the owner.
 *
 * Two locks, both required, neither settable from the browser:
 *   1. `NODE_ENV !== "production"` — the compose stack runs `next dev`, so a
 *      production build can't take this path even if the flag leaks in.
 *   2. the explicit env flag itself.
 *
 * Never set this in a deployed environment.
 */
export const LOCAL_AUTH_BYPASS =
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_AUTH_BYPASS === "true";

/** Stand-in identity used while the bypass is active. */
export const LOCAL_OWNER_EMAIL = process.env.OWNER_EMAIL || "local@localhost";
