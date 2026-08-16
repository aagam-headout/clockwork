import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { RATE_LIMITS, type RateLimitBucket } from "@/lib/limits";

/*
 * Fixed-window rate limiting, counted in Postgres.
 *
 * Not in memory: on serverless functions a module-level counter is
 * per-instance — it can't share a limit across instances serving one user,
 * nor survive a cold start. One upsert per guarded call is cheap at this
 * volume.
 *
 * Fixed windows rather than a sliding log: the failure mode — up to 2× the
 * limit across a window boundary — doesn't matter here. These guard against
 * sustained abuse, not exactness.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Milliseconds until the current window rolls over. */
  retryAfterMs: number;
  limit: number;
};

export async function takeToken(
  userId: string,
  bucket: RateLimitBucket,
): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[bucket];
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const retryAfterMs = windowStart.getTime() + windowMs - Date.now();

  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ userId, bucket, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.userId, rateLimits.bucket, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    return { ok: (row?.count ?? 1) <= limit, retryAfterMs, limit };
  } catch (err) {
    /*
     * Fail open. These limits protect shared quota, not correctness or
     * privacy — refusing every request over an unreachable counter table
     * would turn a bookkeeping problem into an outage.
     */
    console.error("[rate-limit] counter unavailable", err);
    return { ok: true, retryAfterMs, limit };
  }
}

/** Drops counters for windows that have long since closed. */
export async function pruneRateLimits(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, cutoff))
    .returning({ bucket: rateLimits.bucket });
  return deleted.length;
}

/** Current usage in this window, without consuming a token. */
export async function peekUsage(
  userId: string,
  bucket: RateLimitBucket,
): Promise<number> {
  const { windowMs } = RATE_LIMITS[bucket];
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.userId, userId),
        eq(rateLimits.bucket, bucket),
        eq(rateLimits.windowStart, windowStart),
      ),
    )
    .limit(1);
  return row?.count ?? 0;
}
