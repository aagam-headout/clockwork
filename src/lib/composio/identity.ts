/*
 * Mapping between this app's users and Composio's.
 *
 * Composio has no user-provisioning API — an id simply springs into existence
 * the first time it's used in a `link()` or `tools.get()` call — so this is the
 * whole of it: a pure, reversible derivation from `users.id`.
 *
 * Nothing is stored. Deriving the Composio id keeps `users.id` the single
 * source of truth, and makes the reverse mapping the webhook needs (§below) a
 * string operation rather than a lookup.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Namespace prefix. Two jobs:
 *
 *  - Readability. `cw_9f1c…` in the Composio dashboard is obviously ours.
 *  - Isolation. COMPOSIO_API_KEY is app-wide, so a preview deploy pointed at a
 *    restored copy of the production database would otherwise carry the same
 *    users.id values and act on production's connected accounts. Setting
 *    COMPOSIO_USER_NS on preview keeps those namespaces disjoint.
 */
const NS = process.env.COMPOSIO_USER_NS || "cw";

/** The Composio user id for one of our users. */
export function composioUserId(userId: string): string {
  return `${NS}_${userId}`;
}

/**
 * The reverse, for the trigger webhook — which arrives with no session and
 * only a Composio user id to say whose event it is.
 *
 * Returns null for anything that isn't one of ours: a different namespace (a
 * preview deploy's event reaching production), or the legacy fixed id this app
 * used while it was single-user. Callers must treat null as "cannot route" and
 * fail closed rather than falling back to a broadcast.
 */
export function appUserIdFromComposio(raw: string): string | null {
  const prefix = `${NS}_`;
  if (!raw.startsWith(prefix)) return null;
  const id = raw.slice(prefix.length);
  return UUID_RE.test(id) ? id : null;
}
