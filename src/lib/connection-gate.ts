import "server-only";
import { noAuthToolkitSlugs } from "@/lib/composio";
import { activeToolkitSlugs } from "@/lib/data/connections";
import { deliverToolkits, type DeliverTarget } from "@/lib/read-only";

/*
 * Whether a run can actually reach the apps it needs.
 *
 * Before this existed, a workflow whose Slack token had expired went ahead
 * anyway: every Slack tool call came back rejected, the agent was instructed to
 * "say so plainly in one line", and the run was recorded as **ok** with a
 * digest explaining that it couldn't read Slack. The user's dashboard showed a
 * green run. Checking first — and classifying auth failures when a run gets
 * past the check — is what makes a broken connection look broken.
 */

/** Toolkits a run genuinely needs a connected account for. */
export async function requiredToolkits(workflow: {
  toolkits: string[];
  deliver: unknown;
}): Promise<string[]> {
  const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
  // Delivery targets pull in toolkits that aren't in `toolkits` — a Slack DM
  // needs Slack whether or not the workflow reads from it.
  const all = new Set([...workflow.toolkits, ...deliverToolkits(deliver)]);
  const noAuth = await noAuthToolkitSlugs();
  return [...all].filter((slug) => !noAuth.has(slug));
}

export type GateResult =
  { ok: true } | { ok: false; blocked: string[]; reason: string };

/** One indexed read against the connection cache. */
export async function checkConnections(
  userId: string,
  toolkits: string[],
): Promise<GateResult> {
  if (toolkits.length === 0) return { ok: true };

  const active = await activeToolkitSlugs(userId);
  const blocked = toolkits.filter((slug) => !active.has(slug));

  return blocked.length === 0
    ? { ok: true }
    : {
        ok: false,
        blocked,
        reason: `needs a working connection to ${blocked.join(", ")}`,
      };
}

/** Same check against a pre-fetched active set — for the cron tick's loop. */
export function checkConnectionsWith(
  active: Set<string>,
  toolkits: string[],
): GateResult {
  const blocked = toolkits.filter((slug) => !active.has(slug));
  return blocked.length === 0
    ? { ok: true }
    : {
        ok: false,
        blocked,
        reason: `needs a working connection to ${blocked.join(", ")}`,
      };
}

/*
 * Composio returns tool failures as `{ successful: false, error }` rather than
 * throwing, so an expired credential arrives as an ordinary string. Matching on
 * it is unavoidably heuristic — this errs toward recognising auth failures,
 * since the cost of a false positive is a connection marked "expired" that the
 * next reconcile sweep corrects, while a false negative is the silent-green-run
 * bug this whole module exists to fix.
 */
const AUTH_ERROR =
  /\b(401|403)\b|unauthor|unauthentic|invalid[_ -]?(token|grant|credential|api[_ -]?key)|token[_ ]?(has )?expired|expired[_ ]?token|not[_ ]?connected|connected account|no active connection|re-?authenticat|invalid_client|access[_ ]?denied|permission[_ ]?denied/i;

export function isAuthError(message?: string | null): boolean {
  return Boolean(message && AUTH_ERROR.test(message));
}

/** Composio reports failures in the body; the one place that convention is tested. */
export function isFailure(output: unknown): boolean {
  return (
    output !== null &&
    typeof output === "object" &&
    (output as { successful?: boolean }).successful === false
  );
}

/**
 * Maps a tool slug back to the toolkit it came from.
 *
 * Matched against the toolkits the run actually requested, longest first: with
 * both `google` and `google_calendar` in play, a plain prefix scan would
 * attribute `GOOGLE_CALENDAR_LIST_EVENTS` to `google` and mark the wrong
 * connection expired.
 */
export function toolkitForSlug(
  toolSlug: string,
  requested: string[],
): string | null {
  const slug = toolSlug.toLowerCase();
  return (
    [...requested]
      .sort((a, b) => b.length - a.length)
      .find((toolkit) => slug.startsWith(`${toolkit.toLowerCase()}_`)) ?? null
  );
}
