import { describe, expect, it } from "vitest";
import { APP_TIMEZONE, dayKey, daysBetween, startOfDay } from "./time";

// The suite runs with APP_TIMEZONE unset — the Asia/Kolkata default,
// UTC+05:30, no DST — the offset the assertions below encode.
describe(`day bucketing in ${APP_TIMEZONE}`, () => {
  it("puts the boundary at IST midnight, not UTC midnight", () => {
    const morning = new Date("2026-08-11T03:00:00Z"); // 08:30 IST
    expect(startOfDay(morning).toISOString()).toBe("2026-08-10T18:30:00.000Z");
    expect(dayKey(morning)).toBe("2026-08-11");
  });

  it("counts a late-UTC evening as the next IST day", () => {
    // 00:30 IST on the 12th — the case that used to file an early-morning run
    // under the wrong heading.
    const lateUtc = new Date("2026-08-11T19:00:00Z");
    expect(dayKey(lateUtc)).toBe("2026-08-12");
    expect(daysBetween(lateUtc, new Date("2026-08-11T03:00:00Z"))).toBe(1);
  });

  it("treats the same IST day as zero days apart across a UTC midnight", () => {
    // 05:00 IST and 23:00 IST on the 11th, either side of 00:00 UTC.
    expect(
      daysBetween(
        new Date("2026-08-10T23:30:00Z"),
        new Date("2026-08-11T17:30:00Z"),
      ),
    ).toBe(0);
  });
});
