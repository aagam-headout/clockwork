import { describe, expect, it } from "vitest";
import {
  buildCron,
  describeCron,
  parseCron,
  type CronParts,
} from "./cron-builder";

describe("parseCron", () => {
  it("reads the shapes the builder writes", () => {
    expect(parseCron("30 * * * *")).toMatchObject({
      freq: "hourly",
      minute: 30,
    });
    expect(parseCron("0 9 * * *")).toMatchObject({
      freq: "daily",
      hour: 9,
      minute: 0,
    });
    expect(parseCron("0 8 * * 1-5")).toMatchObject({
      freq: "weekdays",
      hour: 8,
    });
    expect(parseCron("30 17 * * 5")).toMatchObject({
      freq: "weekly",
      dow: 5,
      hour: 17,
      minute: 30,
    });
    expect(parseCron("0 6 1 * *")).toMatchObject({ freq: "monthly", dom: 1 });
  });

  it("normalises cron's second Sunday", () => {
    expect(parseCron("0 9 * * 7")).toMatchObject({ freq: "weekly", dow: 0 });
  });

  it("gives up on anything it can't round-trip", () => {
    for (const expr of [
      "*/15 * * * *", // step
      "0 9 * * 1,3", // list
      "0 9 * 6 *", // month restriction
      "0 9 1 * 1", // both day fields
      "0 99 * * *", // out of range
      "0 9 * *", // too few fields
      "",
    ]) {
      expect(parseCron(expr), expr).toBeNull();
    }
  });
});

describe("buildCron", () => {
  const base: CronParts = {
    freq: "daily",
    minute: 15,
    hour: 7,
    dow: 3,
    dom: 12,
  };

  it("emits only the fields its frequency uses", () => {
    expect(buildCron({ ...base, freq: "hourly" })).toBe("15 * * * *");
    expect(buildCron({ ...base, freq: "daily" })).toBe("15 7 * * *");
    expect(buildCron({ ...base, freq: "weekdays" })).toBe("15 7 * * 1-5");
    expect(buildCron({ ...base, freq: "weekly" })).toBe("15 7 * * 3");
    expect(buildCron({ ...base, freq: "monthly" })).toBe("15 7 12 * *");
  });

  it("round-trips through the parser", () => {
    for (const freq of [
      "hourly",
      "daily",
      "weekdays",
      "weekly",
      "monthly",
    ] as const) {
      const parts = { ...base, freq };
      expect(parseCron(buildCron(parts)), freq).toMatchObject({ freq });
    }
  });
});

describe("describeCron", () => {
  it("says what the expression means", () => {
    expect(describeCron("0 8 * * 1-5")).toBe(
      "Every weekday (Mon–Fri) at 8:00 AM",
    );
    expect(describeCron("0 9 * * *")).toBe("Every day at 9:00 AM");
    expect(describeCron("30 17 * * 5")).toBe("Every Friday at 5:30 PM");
    expect(describeCron("0 0 * * *")).toBe("Every day at 12:00 AM");
    expect(describeCron("0 12 * * *")).toBe("Every day at 12:00 PM");
    expect(describeCron("0 6 1 * *")).toBe("The 1st of every month at 6:00 AM");
    expect(describeCron("0 * * * *")).toBe("Every hour, on the hour");
    expect(describeCron("15 * * * *")).toBe("Every hour, at 15 past");
  });

  it("returns null where the caller should fall back to the next-run time", () => {
    expect(describeCron("*/15 9-17 * * 1,3")).toBeNull();
  });
});
