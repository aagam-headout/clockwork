/**
 * Resolves the deployment's own public origin.
 *
 * A self-hosted deploy can't know its own URL before it exists, so the
 * one-click Vercel flow can't prompt for `APP_URL` / `NEON_AUTH_BASE_URL` up
 * front. Vercel injects `VERCEL_PROJECT_PRODUCTION_URL` (the stable
 * production domain, not the per-deployment `VERCEL_URL`) into every
 * deployment, so it stands in when the explicit variable is unset. The
 * explicit one still wins — that's how a custom domain or local tunnel
 * overrides it.
 *
 * Returns undefined when neither source is available; callers decide whether
 * that's fatal.
 */
export function resolveBaseUrl(
  explicit: string | undefined,
): string | undefined {
  if (explicit) return explicit.replace(/\/$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : undefined;
}
