"use client";

/**
 * A three-control schedule picker that writes a cron expression.
 *
 * The form used to offer four fixed presets (weekdays 8am, daily 9am, hourly,
 * Fridays 5pm). Anything outside that set — "Tuesdays at 6:30", "the 1st of the
 * month" — meant hand-writing five fields, which is the one part of this form
 * people get wrong. The presets covered four schedules; these combos cover
 * every schedule anyone sets an unattended digest to.
 *
 * State lives in the cron string itself, not beside it: the builder parses the
 * current value on every render and writes a new one on every change. So the
 * raw cron field below stays the source of truth and the two can never drift —
 * type `0 6 * * 2` by hand and the combos follow.
 */

export type CronParts = {
  freq: "hourly" | "daily" | "weekdays" | "weekly" | "monthly";
  minute: number;
  hour: number;
  /** 0–6, Sunday first — only meaningful when `freq` is "weekly". */
  dow: number;
  /** 1–31 — only meaningful when `freq` is "monthly". */
  dom: number;
};

const DEFAULTS: CronParts = {
  freq: "daily",
  minute: 0,
  hour: 9,
  dow: 1,
  dom: 1,
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const FREQUENCIES: Array<{ value: CronParts["freq"]; label: string }> = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

const int = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : null);

/**
 * The subset of cron this builder can round-trip. Anything else — step values,
 * lists, ranges other than the weekday one, a month restriction — parses to
 * null, and the UI says so rather than silently rewriting someone's expression.
 */
export function parseCron(expr: string): CronParts | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, month, dow] = parts;
  if (month !== "*") return null;

  const minute = int(m);
  if (minute === null || minute > 59) return null;

  if (h === "*") {
    // Hourly is the one shape with no hour of its own.
    return dom === "*" && dow === "*"
      ? { ...DEFAULTS, freq: "hourly", minute }
      : null;
  }

  const hour = int(h);
  if (hour === null || hour > 23) return null;
  const base = { ...DEFAULTS, minute, hour };

  if (dom === "*" && dow === "*") return { ...base, freq: "daily" };
  if (dom === "*" && dow === "1-5") return { ...base, freq: "weekdays" };
  if (dom === "*") {
    const d = int(dow);
    // cron accepts 7 for Sunday; normalise so the select matches.
    if (d !== null && d <= 7) return { ...base, freq: "weekly", dow: d % 7 };
    return null;
  }
  if (dow === "*") {
    const d = int(dom);
    if (d !== null && d >= 1 && d <= 31)
      return { ...base, freq: "monthly", dom: d };
  }
  return null;
}

export function buildCron(p: CronParts): string {
  switch (p.freq) {
    case "hourly":
      return `${p.minute} * * * *`;
    case "daily":
      return `${p.minute} ${p.hour} * * *`;
    case "weekdays":
      return `${p.minute} ${p.hour} * * 1-5`;
    case "weekly":
      return `${p.minute} ${p.hour} * * ${p.dow}`;
    case "monthly":
      return `${p.minute} ${p.hour} ${p.dom} * *`;
  }
}

/**
 * The expression in plain English — "Every weekday at 8:00 AM".
 *
 * The cron field used to explain itself only by showing the next fire time,
 * which answers "when next" but not "what does this mean": `0 8 * * 1-5` and
 * `0 8 * * 1` both read as "Next: Mon 8:00" on a Sunday. Returns null for
 * expressions outside the builder's grammar, where the caller falls back to the
 * next-run preview.
 */
export function describeCron(expr: string): string | null {
  const p = parseCron(expr);
  if (!p) return null;
  const at = `at ${clockTime(p.hour, p.minute)}`;
  switch (p.freq) {
    case "hourly":
      return p.minute === 0
        ? "Every hour, on the hour"
        : `Every hour, at ${p.minute} past`;
    case "daily":
      return `Every day ${at}`;
    case "weekdays":
      return `Every weekday (Mon–Fri) ${at}`;
    case "weekly":
      return `Every ${WEEKDAYS[p.dow]} ${at}`;
    case "monthly":
      return `The ${ordinal(p.dom)} of every month ${at}`;
  }
}

/** 8:00 AM / 12:30 PM — 12-hour, since that's how the schedules are spoken. */
function clockTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${suffix}`;
}

export function CronBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (cron: string) => void;
}) {
  const parsed = parseCron(value);
  // An unparseable expression still gets working controls — they start from the
  // defaults, and touching one commits that schedule over the custom string.
  const p = parsed ?? DEFAULTS;
  const set = (patch: Partial<CronParts>) =>
    onChange(buildCron({ ...p, ...patch }));

  return (
    <div className="flex flex-col gap-2">
      {/* Wraps rather than scrolls: the rail this sits in is ~344px, so on a
          narrow pane each control takes its own line. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="How often"
          value={p.freq}
          onChange={(e) => set({ freq: e.target.value as CronParts["freq"] })}
          className="input h-9 w-auto min-w-[8.5rem] flex-1 py-0 text-[13px]"
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {p.freq === "weekly" && (
          <select
            aria-label="Day of the week"
            value={p.dow}
            onChange={(e) => set({ dow: Number(e.target.value) })}
            className="input h-9 w-auto min-w-[7.5rem] flex-1 py-0 text-[13px]"
          >
            {WEEKDAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        )}

        {p.freq === "monthly" && (
          <select
            aria-label="Day of the month"
            value={p.dom}
            onChange={(e) => set({ dom: Number(e.target.value) })}
            className="input h-9 w-auto min-w-[6rem] flex-1 py-0 text-[13px]"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
              </option>
            ))}
          </select>
        )}

        {p.freq === "hourly" ? (
          <label className="text-muted flex items-center gap-1.5 text-[13px]">
            at minute
            <input
              type="number"
              min={0}
              max={59}
              aria-label="Minute past the hour"
              value={p.minute}
              onChange={(e) =>
                set({ minute: clamp(Number(e.target.value), 0, 59) })
              }
              className="input h-9 w-[4.5rem] py-0 text-[13px]"
            />
          </label>
        ) : (
          <label className="text-muted flex items-center gap-1.5 text-[13px]">
            at
            <input
              type="time"
              aria-label="Time of day"
              value={`${pad(p.hour)}:${pad(p.minute)}`}
              onChange={(e) => {
                // An emptied time input reports "", which would otherwise write
                // NaN into the expression.
                const [h, m] = e.target.value.split(":").map(Number);
                if (Number.isFinite(h) && Number.isFinite(m))
                  set({ hour: h, minute: m });
              }}
              className="input h-9 w-auto py-0 text-[13px]"
            />
          </label>
        )}
      </div>

      {!parsed && value.trim() && (
        <p className="text-subtle text-xs">
          Custom expression — a control above replaces it.
        </p>
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
