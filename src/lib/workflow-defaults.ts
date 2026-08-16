import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";

/*
 * Per-account defaults prefilled onto a brand-new workflow's form —
 * timezone and monthly spend cap. Null/absent means "no stored default";
 * the form falls back to its own built-in defaults (Asia/Kolkata,
 * uncapped), same as before this existed.
 */

// Per-process and short: a save clears the cache in the instance that served
// it, so on more than one instance another instance can prefill the previous
// values until this expires. Ten seconds keeps that window smaller than the
// time it takes to walk from Save to "New workflow".
const DEFAULTS_TTL_MS = 10_000;

type WorkflowDefaults = {
  timezone?: string;
  monthlyCostCapUsd?: string;
};

const defaultsCache = new Map<
  string,
  { at: number; value: WorkflowDefaults }
>();

function clearWorkflowDefaultsCache(userId: string) {
  defaultsCache.delete(userId);
}

export async function getWorkflowDefaultsForUser(
  userId: string,
): Promise<WorkflowDefaults> {
  const hit = defaultsCache.get(userId);
  if (hit && Date.now() - hit.at < DEFAULTS_TTL_MS) return hit.value;

  /*
   * Not wrapped in a try/catch: an account with no settings row yet is the
   * normal case and comes back as an empty result, not a throw. The only
   * thing a catch here could swallow is a real database failure — which
   * belongs on the error boundary, not cached as "you have no defaults" for
   * the next ten seconds while the form quietly reverts them.
   */
  const [row] = await db
    .select({
      timezone: userSettings.defaultTimezone,
      monthlyCostCapUsd: userSettings.defaultMonthlyCostCapUsd,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  const value: WorkflowDefaults = row
    ? {
        timezone: row.timezone ?? undefined,
        monthlyCostCapUsd: row.monthlyCostCapUsd ?? undefined,
      }
    : {};

  defaultsCache.set(userId, { at: Date.now(), value });
  return value;
}

export async function setWorkflowDefaultsForUser(
  userId: string,
  email: string,
  defaults: { timezone: string | null; monthlyCostCapUsd: string | null },
): Promise<void> {
  await db
    .insert(userSettings)
    .values({
      email: email.toLowerCase(),
      userId,
      defaultTimezone: defaults.timezone,
      defaultMonthlyCostCapUsd: defaults.monthlyCostCapUsd,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSettings.email,
      set: {
        userId,
        defaultTimezone: defaults.timezone,
        defaultMonthlyCostCapUsd: defaults.monthlyCostCapUsd,
        updatedAt: new Date(),
      },
    });
  clearWorkflowDefaultsCache(userId);
}
