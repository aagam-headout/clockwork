import { describe, expect, it, vi, beforeEach } from "vitest";

const select = vi.fn();

vi.mock("@/db", () => ({
  db: { select: (...args: unknown[]) => select(...args) },
}));

import {
  parseSince,
  searchDigests,
  signalTimeline,
  MAX_SEARCH_LIMIT,
  MAX_TIMELINE_POINTS,
} from "./digest-search";

const NOW = new Date("2026-08-15T00:00:00Z");

describe("parseSince", () => {
  it("returns undefined for no input", () => {
    expect(parseSince(undefined, NOW)).toEqual({ ok: true, date: undefined });
  });

  it("parses days", () => {
    const out = parseSince("30d", NOW);
    expect(out.ok && out.date?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("parses weeks", () => {
    const out = parseSince("2w", NOW);
    expect(out.ok && out.date?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("parses months as 30 days", () => {
    const out = parseSince("6m", NOW);
    expect(out.ok && out.date?.toISOString()).toBe("2026-02-16T00:00:00.000Z");
  });

  it("tolerates whitespace and capitals", () => {
    expect(parseSince(" 30 D ", NOW).ok).toBe(true);
  });

  it("rejects an unknown unit", () => {
    const out = parseSince("5y", NOW);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/d, w or m/);
  });

  it("rejects a non-numeric amount", () => {
    expect(parseSince("lots", NOW).ok).toBe(false);
  });

  it("rejects zero and negative windows", () => {
    expect(parseSince("0d", NOW).ok).toBe(false);
    expect(parseSince("-3d", NOW).ok).toBe(false);
  });
});

/**
 * Captures the query the search builds without a database.
 *
 * The owner filter is the security surface here, applied as a drizzle
 * condition rather than raw SQL, so the assertion looks for the user id
 * anywhere in the serialised predicate.
 */
/*
 * Drizzle's condition tree holds back-references to its own tables, so
 * JSON.stringify throws on it. This walks it instead, collecting the bound
 * primitive values — all these assertions need.
 */
function boundValues(node: unknown, seen = new WeakSet()): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === "string") return [node];
  if (typeof node === "number" || typeof node === "boolean") {
    return [String(node)];
  }
  if (typeof node !== "object") return [];
  if (seen.has(node)) return [];
  seen.add(node);

  // Columns carry a `table` back-reference; following it walks the whole
  // schema and finds nothing a caller passed in.
  const entries = Object.entries(node as Record<string, unknown>).filter(
    ([key]) => key !== "table",
  );
  return entries.flatMap(([, value]) => boundValues(value, seen));
}

/** Column names the predicate touches, for filters whose value says nothing. */
function filteredColumns(node: unknown, seen = new WeakSet()): string[] {
  if (!node || typeof node !== "object") return [];
  if (seen.has(node)) return [];
  seen.add(node);

  const record = node as Record<string, unknown>;
  const self =
    "columnType" in record && typeof record.name === "string"
      ? [record.name]
      : [];

  return [
    ...self,
    ...Object.entries(record)
      .filter(([key]) => key !== "table")
      .flatMap(([, value]) => filteredColumns(value, seen)),
  ];
}

function selectChain(captured: {
  where?: string;
  columns?: string[];
  limit?: number;
}) {
  const link = {
    from: () => link,
    innerJoin: () => link,
    where: (predicate: unknown) => {
      captured.where = boundValues(predicate).join(" ");
      captured.columns = filteredColumns(predicate);
      return link;
    },
    orderBy: () => link,
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve([]);
    },
  };
  return link;
}

beforeEach(() => select.mockReset());

describe("searchDigests", () => {
  it("always filters on the owner", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1", q: "churn" });

    expect(captured.where).toContain("user-1");
  });

  it("filters on the owner even with no query at all", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1" });

    expect(captured.where).toContain("user-1");
  });

  it("narrows to one workflow when asked", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1", workflowId: "wf-9" });

    expect(captured.where).toContain("wf-9");
  });

  it("clamps the limit to the maximum", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1", limit: 500 });

    expect(captured.limit).toBe(MAX_SEARCH_LIMIT);
  });

  it("clamps a nonsense limit up to at least one", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1", limit: 0 });

    expect(captured.limit).toBe(1);
  });

  it("defaults the limit when none is given", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1" });

    expect(captured.limit).toBe(10);
  });

  it("excludes unchanged runs", async () => {
    /*
     * An unchanged run's body is the literal "NO_UPDATES" sentinel, not an
     * empty string, so the body filter alone let the sentinel come back as a
     * search hit — in /runs and in the agent's `history` tool.
     */
    const captured: { where?: string; columns?: string[]; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await searchDigests({ userId: "user-1", q: "churn" });

    expect(captured.columns).toContain("unchanged");
  });
});

describe("signalTimeline", () => {
  it("bounds how many points one chart can read", async () => {
    // The day window is not a bound: an event workflow can produce hundreds
    // of runs a day, more than a chart has pixels to draw.
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await signalTimeline("user-1", "wf-9", 30);

    expect(captured.limit).toBe(MAX_TIMELINE_POINTS);
  });

  it("stays scoped to the owner and the workflow", async () => {
    const captured: { where?: string; limit?: number } = {};
    select.mockReturnValue(selectChain(captured));

    await signalTimeline("user-1", "wf-9", 30);

    expect(captured.where).toContain("user-1");
    expect(captured.where).toContain("wf-9");
  });
});
