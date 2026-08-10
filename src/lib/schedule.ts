import { CronExpressionParser } from "cron-parser";

/**
 * A workflow is "due" if its most recent scheduled fire time (per its own
 * cron + timezone) is after `lastAttemptAt` — i.e. at least one tick has
 * passed since it last *tried* to run. Tick cadence (every 5 minutes) is the
 * real schedule resolution; the cron expression only has to be coarser.
 *
 * Dueness deliberately keys off the attempt, not the success: keying off
 * success means a workflow that errors is still due on the next tick, and
 * retries every 5 minutes forever.
 *
 * Throws when the cron expression is invalid — the caller records that as a
 * per-workflow problem rather than failing the whole tick.
 */
export function isDue(
  cron: string,
  timezone: string,
  lastAttemptAt: Date | null,
  now: Date,
): boolean {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: now,
    tz: timezone,
  });
  const mostRecentFire = interval.prev().toDate();
  if (!lastAttemptAt) return true;
  return mostRecentFire > lastAttemptAt;
}
