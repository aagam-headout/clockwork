import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { startOfMonthInZone, judgeCap } from "./cost-cap";

describe("startOfMonthInZone", () => {
  it("finds the month start for a zone ahead of UTC", () => {
    // 2026-08-15 12:00 UTC = 17:30 IST on the 15th; month began 2026-08-01
    // 00:00 IST = 2026-07-31 18:30 UTC.
    const out = startOfMonthInZone(
      "Asia/Kolkata",
      new Date("2026-08-15T12:00:00Z"),
    );
    expect(out.toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  it("finds the month start for UTC itself", () => {
    const out = startOfMonthInZone("UTC", new Date("2026-08-15T12:00:00Z"));
    expect(out.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("finds the month start for a zone behind UTC", () => {
    // 2026-08-01 03:00 UTC is still 2026-07-31 20:00 in LA — month not over yet.
    const out = startOfMonthInZone(
      "America/Los_Angeles",
      new Date("2026-08-01T03:00:00Z"),
    );
    expect(out.toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });

  it("rolls over at the zone's own midnight, not UTC's", () => {
    // 18:00 UTC on 31 July is 23:30 IST — still July there.
    const july = startOfMonthInZone(
      "Asia/Kolkata",
      new Date("2026-07-31T18:00:00Z"),
    );
    expect(july.toISOString()).toBe("2026-06-30T18:30:00.000Z");

    // 19:00 UTC on 31 July is 00:30 IST on 1 August — now August there.
    const august = startOfMonthInZone(
      "Asia/Kolkata",
      new Date("2026-07-31T19:00:00Z"),
    );
    expect(august.toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    const out = startOfMonthInZone(
      "Not/AZone",
      new Date("2026-08-15T12:00:00Z"),
    );
    expect(out.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("handles a January boundary without rolling the year wrong", () => {
    const out = startOfMonthInZone("UTC", new Date("2026-01-15T12:00:00Z"));
    expect(out.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("judgeCap", () => {
  it("is uncapped for a null cap", () => {
    expect(judgeCap(99, null)).toEqual({
      state: "uncapped",
      spent: 99,
      cap: null,
    });
  });

  it("treats a zero or negative cap as uncapped rather than blocking", () => {
    expect(judgeCap(1, 0).state).toBe("uncapped");
    expect(judgeCap(1, -5).state).toBe("uncapped");
  });

  it("is ok below the warning ratio", () => {
    expect(judgeCap(1, 10).state).toBe("ok");
  });

  it("warns at exactly 80 percent", () => {
    expect(judgeCap(8, 10).state).toBe("warn");
  });

  it("warns just under the cap", () => {
    expect(judgeCap(9.99, 10).state).toBe("warn");
  });

  it("is over at exactly the cap", () => {
    expect(judgeCap(10, 10).state).toBe("over");
  });

  it("is over beyond the cap", () => {
    expect(judgeCap(10.01, 10).state).toBe("over");
  });

  it("reports the numbers it judged on", () => {
    expect(judgeCap(4.5, 10)).toEqual({ state: "ok", spent: 4.5, cap: 10 });
  });
});
