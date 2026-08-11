"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Every timestamp in the app, formatted in the *reader's* timezone.
 *
 * The pages that show these are server components, so `date.toLocaleString()`
 * there formats in the *server's* zone — UTC in production. A digest delivered at
 * 08:00 IST rendered as "2:30 AM", which reads as a broken scheduler rather
 * than a display bug.
 *
 * So the first paint (server, and the hydration that has to match it) is
 * deliberately formatted in a fixed zone, and an effect re-formats in the
 * browser's zone right after mount. Both renders agree, so there's no
 * mismatch, and the reader ends up with local time.
 *
 * Note this is *display* only. Scheduling is a separate thing with its own
 * per-workflow `timezone` column — a workflow set to Asia/Kolkata fires on IST
 * no matter where it's read from.
 */
export type TimeFormat =
  | "time" // 2:05 PM
  | "date" // Aug 11
  | "datetime" // Aug 11, 2:05 PM
  | "long" // Monday, August 11 at 2:05 PM
  | "weekday"; // Monday, August 11

const OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions> = {
  time: { hour: "numeric", minute: "2-digit" },
  date: { month: "short", day: "numeric" },
  datetime: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  long: {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  weekday: { weekday: "long", month: "long", day: "numeric" },
};

/** The zone both the server render and the pre-mount client render use. */
const SSR_ZONE = "UTC";

/**
 * False during SSR and the hydrating render, true from the first client render
 * onwards — the standard hydration-safe "am I in a browser yet" store. A
 * `useEffect` + `setState` would do the same job, but React 19 flags that as a
 * cascading render, and this needs no state at all.
 */
const subscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

function render(value: Date, format: TimeFormat, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    ...OPTIONS[format],
    ...(timeZone ? { timeZone } : {}),
  }).format(value);
}

/**
 * "Good morning — Monday, August 11", both halves decided by the reader's
 * clock. The greeting has the same server-zone problem as any timestamp: at
 * 09:00 IST the server is still on yesterday evening's UTC hour and the page
 * opened with "Good evening".
 */
export function LocalDayGreeting({ className }: { className?: string }) {
  // Fixed at first render so the server and hydration agree; the effect below
  // is what makes the greeting local, not a later clock reading.
  const [now] = useState(() => new Date());
  const mounted = useMounted();

  // Pre-mount there's no honest answer — the server's hour is the wrong clock —
  // and a wrong greeting is worse than a late one, so the date carries the
  // header alone for that one render.
  const hour = mounted ? new Date().getHours() : null;
  const greeting =
    hour == null
      ? null
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";

  return (
    <span className={className}>
      {greeting && `${greeting} — `}
      <LocalTime value={now} format="weekday" />
    </span>
  );
}

export function LocalTime({
  value,
  format = "datetime",
  className,
  /** Rendered before the formatted value, e.g. "ended ". */
  prefix,
}: {
  /** A Date, or its ISO string when it crossed a server/client boundary. */
  value: Date | string;
  format?: TimeFormat;
  className?: string;
  prefix?: string;
}) {
  const date = typeof value === "string" ? new Date(value) : value;
  const mounted = useMounted();

  return (
    <time dateTime={date.toISOString()} className={className}>
      {prefix}
      {/* Once mounted, no `timeZone` — Intl picks up the browser's own. */}
      {render(date, format, mounted ? undefined : SSR_ZONE)}
    </time>
  );
}
