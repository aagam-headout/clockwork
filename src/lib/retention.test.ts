import { describe, expect, it, vi, beforeEach } from "vitest";

const update = vi.fn();

vi.mock("@/db", () => ({
  db: { update: (...args: unknown[]) => update(...args) },
}));

import {
  OUTPUT_RETENTION_DAYS,
  RUN_RETENTION_DAYS,
  reapStuckRuns,
} from "./retention";
import { CHAIN_QUEUE_MAX_AGE_MS } from "@/lib/limits";

/**
 * Captures the predicate the reaper builds.
 *
 * The behaviour under test is SQL, so what is asserted here is the shape of
 * the statement: which columns and cutoffs it distinguishes. The rows it
 * actually touches are checked against a real database in the plan's manual
 * verification step.
 */
function updateChain(captured: { sql?: string; params: unknown[] }) {
  return {
    set: () => ({
      where: (predicate: { queryChunks?: unknown[] }) => {
        const chunks = predicate.queryChunks ?? [];
        captured.sql = chunks
          .map((chunk) => {
            if (chunk && typeof chunk === "object" && "value" in chunk) {
              const value = (chunk as { value: unknown }).value;
              return Array.isArray(value) ? value.join("") : String(value);
            }
            if (chunk instanceof Date) {
              captured.params.push(chunk);
              return "?";
            }
            if (chunk && typeof chunk === "object" && "name" in chunk) {
              return String((chunk as { name: unknown }).name);
            }
            return "";
          })
          .join("");
        return { returning: () => Promise.resolve([]) };
      },
    }),
  };
}

beforeEach(() => update.mockReset());

describe("reapStuckRuns", () => {
  it("distinguishes chained queued rows from every other queued row", async () => {
    const captured: { sql?: string; params: unknown[] } = { params: [] };
    update.mockReturnValue(updateChain(captured));

    await reapStuckRuns();

    // Without this branch, a chained run waiting for tick budget is errored
    // out at 15 minutes while it is still perfectly valid work.
    expect(captured.sql).toContain("'workflow'");
    expect(captured.sql).toContain("trigger");
    expect(captured.sql).toContain("status");
  });

  it("uses a later cutoff for chained rows than for the rest", async () => {
    const captured: { sql?: string; params: unknown[] } = { params: [] };
    update.mockReturnValue(updateChain(captured));

    await reapStuckRuns(15 * 60_000);

    const dates = captured.params.filter((p): p is Date => p instanceof Date);
    expect(dates.length).toBeGreaterThanOrEqual(2);

    // The chain cutoff reaches further back, so fewer chained rows qualify.
    const oldest = dates.reduce((a, b) => (a < b ? a : b));
    const newest = dates.reduce((a, b) => (a > b ? a : b));
    expect(newest.getTime() - oldest.getTime()).toBe(
      CHAIN_QUEUE_MAX_AGE_MS - 15 * 60_000,
    );
  });

  it("defaults the chain window to an hour", () => {
    expect(CHAIN_QUEUE_MAX_AGE_MS).toBe(60 * 60 * 1000);
  });
});

describe("retention windows", () => {
  it("keeps digests far longer than traces", () => {
    expect(OUTPUT_RETENTION_DAYS).toBeGreaterThan(RUN_RETENTION_DAYS);
  });

  it("defaults to a year of digests", () => {
    expect(OUTPUT_RETENTION_DAYS).toBe(365);
  });

  it("defaults to a month of traces", () => {
    expect(RUN_RETENTION_DAYS).toBe(30);
  });
});
