import { CronExpressionParser } from "cron-parser";

/**
 * A workflow is "due" if its most recent scheduled fire time (per its own
 * cron + timezone) is after `lastAttemptAt` — i.e. at least one tick has
 * passed since it last *tried* to run. Tick cadence (every 5 minutes) is the
 * real schedule resolution; the cron expression only needs to be coarser.
 *
 * Keys off the attempt, not the success, deliberately: keying off success
 * means an erroring workflow stays due every tick and retries forever.
 *
 * Throws on an invalid cron expression — the caller records that as a
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

/**
 * Shortest gap between consecutive fires of a cron expression, in minutes.
 *
 * Rejects schedules faster than the app can honour. The tick runs every 5
 * minutes, so anything below that is a promise the scheduler can't keep —
 * and with open signup, `* * * * *` is also the cheapest way to monopolise
 * the tick budget.
 *
 * Sampled over the next few fires rather than computed analytically: cron
 * intervals aren't uniform (`0 9 * * 1-5` jumps 72 hours over a weekend), and
 * the shortest gap is what matters. Returns Infinity for an expression that
 * never fires again.
 */
export function minIntervalMinutes(
  cron: string,
  timezone: string,
  samples = 6,
): number {
  const interval = CronExpressionParser.parse(cron, { tz: timezone });

  let previous: Date | null = null;
  let smallest = Infinity;

  for (let i = 0; i < samples; i++) {
    const next = interval.next().toDate();
    if (previous) {
      smallest = Math.min(
        smallest,
        (next.getTime() - previous.getTime()) / 60_000,
      );
    }
    previous = next;
  }

  return smallest;
}
