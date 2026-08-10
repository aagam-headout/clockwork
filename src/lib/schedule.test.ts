import { describe, expect, it } from "vitest";
import { isDue } from "./schedule";

const TZ = "Asia/Kolkata";
// 2026-08-10 08:30 IST — half an hour past a "weekdays 8am" fire time.
const now = new Date("2026-08-10T03:00:00.000Z");
const cron = "0 8 * * 1-5";

describe("isDue", () => {
  it("is due when it has never run", () => {
    expect(isDue(cron, TZ, null, now)).toBe(true);
  });

  it("is due when the last attempt predates the most recent fire time", () => {
    const yesterday = new Date("2026-08-09T03:00:00.000Z");
    expect(isDue(cron, TZ, yesterday, now)).toBe(true);
  });

  it("is not due when it already ran after the most recent fire time", () => {
    const justRan = new Date("2026-08-10T02:31:00.000Z"); // 08:01 IST
    expect(isDue(cron, TZ, justRan, now)).toBe(false);
  });

  it("does not re-fire on every tick within the same window", () => {
    const ranAtFire = new Date("2026-08-10T02:30:30.000Z");
    const fiveMinutesLater = new Date("2026-08-10T03:05:00.000Z");
    expect(isDue(cron, TZ, ranAtFire, fiveMinutesLater)).toBe(false);
  });

  it("respects the workflow's own timezone", () => {
    // 08:00 in New York is well after 08:00 in Kolkata on the same date, so
    // the same instant is past the fire time in one zone and not the other.
    const beforeNyFire = new Date("2026-08-10T03:00:00.000Z");
    expect(isDue(cron, "America/New_York", null, beforeNyFire)).toBe(true);
  });

  it("throws on an invalid expression rather than guessing", () => {
    expect(() => isDue("not a cron", TZ, null, now)).toThrow();
  });
});
