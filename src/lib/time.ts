/**
 * Server-side day arithmetic.
 *
 * Instants are *displayed* in the reader's own zone by `<LocalTime>`, but a
 * few things must be decided on the server first — which outputs count as
 * "today", which day heading a run sits under. `new Date()` there runs in
 * the host's zone, UTC in production: for an IST reader the overview stayed
 * empty until 05:30 and every early-morning run was filed under yesterday.
 *
 * So bucketing uses one declared zone instead of the host's. Set
 * `APP_TIMEZONE` to the zone the app's day should follow; it defaults to the
 * same Asia/Kolkata the workflow form uses. Readers elsewhere still see
 * their own local clock on every timestamp — only the day boundary is fixed.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

/** The wall-clock Y/M/D of an instant in `APP_TIMEZONE`. */
function partsInZone(date: Date) {
  // en-CA gives ISO-ish YYYY-MM-DD, which parses back without regex work.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return { y, m, d };
}

/** `YYYY-MM-DD` for the day this instant falls on in `APP_TIMEZONE`. */
export function dayKey(date: Date): string {
  const { y, m, d } = partsInZone(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The instant `APP_TIMEZONE`'s day containing `date` began — as a real UTC
 * Date, so it can go straight into a query comparison.
 */
export function startOfDay(date: Date = new Date()): Date {
  const { y, m, d } = partsInZone(date);
  // Guess midnight UTC for that calendar day, then correct by how far the
  // zone was offset at that moment. One correction suffices: a DST shift
  // moves the boundary by an hour, never a day. (Asia/Kolkata has no DST;
  // this keeps the helper honest for zones that do.)
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - zoneOffsetMs(new Date(guess)));
}

/** How far `APP_TIMEZONE` is ahead of UTC at a given instant, in ms. */
function zoneOffsetMs(at: Date): number {
  // `en-US` + `timeZone` formats the instant's wall clock there; reading it
  // back as if it were UTC gives the offset.
  const wall = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(at)
      // "08/11/2026, 05:30:00" → "2026-08-11T05:30:00Z"
      .replace(
        /(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/,
        "$3-$1-$2T$4:$5:$6Z",
      ),
  );
  return wall.getTime() - at.getTime();
}

/** Whole days between two instants, counted by `APP_TIMEZONE` calendar days. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000,
  );
}
