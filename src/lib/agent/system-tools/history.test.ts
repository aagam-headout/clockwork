import { describe, expect, it, vi, beforeEach } from "vitest";

const searchDigests = vi.fn();

vi.mock("@/lib/data/digest-search", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/data/digest-search")
  >("@/lib/data/digest-search");
  return {
    ...actual,
    searchDigests: (...args: unknown[]) => searchDigests(...args),
  };
});

vi.mock("@/db", () => ({ db: {} }));

import { createHistoryTool } from "./history";
import type { SystemToolContext } from "./context";

function makeCtx(over: Partial<SystemToolContext> = {}) {
  return {
    store: {} as never,
    budgetSpent: () => null,
    markDegraded: vi.fn(),
    signals: [],
    setEnvelope: vi.fn(),
    ownerId: "user-1",
    workflowId: "wf-1",
    historySpent: () => null,
    ...over,
  } as SystemToolContext;
}

async function run(tool: ReturnType<typeof createHistoryTool>, input: unknown) {
  return (await tool.execute?.(input as never, {} as never)) as Record<
    string,
    unknown
  >;
}

const HIT = {
  runId: "r1",
  workflowId: "wf-1",
  workflowName: "Digest",
  date: new Date("2026-08-01T00:00:00Z"),
  excerpt: "churn ticked up",
  signals: { rate: 4.1 },
  severity: "warn",
};

beforeEach(() => searchDigests.mockReset());

describe("history tool", () => {
  it("scopes to the calling workflow by default", async () => {
    searchDigests.mockResolvedValue([]);
    await run(createHistoryTool(makeCtx()), { q: "churn" });

    expect(searchDigests).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", workflowId: "wf-1" }),
    );
  });

  it("widens to the owner but never past them", async () => {
    searchDigests.mockResolvedValue([]);
    await run(createHistoryTool(makeCtx()), { q: "churn", scope: "user" });

    const args = searchDigests.mock.calls[0][0];
    expect(args.userId).toBe("user-1");
    expect(args.workflowId).toBeUndefined();
  });

  it("takes the owner from the run, not from the arguments", async () => {
    searchDigests.mockResolvedValue([]);
    // A model that invents an argument must not be able to reach another
    // account's digests with it.
    await run(createHistoryTool(makeCtx()), {
      q: "churn",
      userId: "someone-else",
    });

    expect(searchDigests.mock.calls[0][0].userId).toBe("user-1");
  });

  it("passes the parsed window through", async () => {
    searchDigests.mockResolvedValue([]);
    await run(createHistoryTool(makeCtx()), { since: "30d" });

    expect(searchDigests.mock.calls[0][0].since).toBeInstanceOf(Date);
  });

  it("rejects an unreadable since window", async () => {
    const out = await run(createHistoryTool(makeCtx()), { since: "5y" });
    expect(out.error).toMatch(/d, w or m/);
    expect(searchDigests).not.toHaveBeenCalled();
  });

  it("says so explicitly when nothing matches", async () => {
    searchDigests.mockResolvedValue([]);
    const out = await run(createHistoryTool(makeCtx()), { q: "nothing" });
    expect(out.result).toMatch(/no prior digests/i);
    expect(out.count).toBe(0);
  });

  it("returns compact rows with signals", async () => {
    searchDigests.mockResolvedValue([HIT]);
    const out = await run(createHistoryTool(makeCtx()), { q: "churn" });

    expect(out.count).toBe(1);
    expect(out.results).toEqual([
      {
        date: "2026-08-01",
        workflow: "Digest",
        excerpt: "churn ticked up",
        signals: { rate: 4.1 },
        severity: "warn",
      },
    ]);
  });

  it("omits signals and severity when there are none", async () => {
    searchDigests.mockResolvedValue([
      { ...HIT, signals: null, severity: null },
    ]);
    const out = await run(createHistoryTool(makeCtx()), {});

    expect(out.results).toEqual([
      { date: "2026-08-01", workflow: "Digest", excerpt: "churn ticked up" },
    ]);
  });

  it("notes when the limit was clamped", async () => {
    searchDigests.mockResolvedValue([HIT]);
    const out = await run(createHistoryTool(makeCtx()), { limit: 500 });
    expect(out.note).toMatch(/clamped to 50/);
  });

  it("refuses once the budget is spent", async () => {
    const out = await run(
      createHistoryTool(makeCtx({ historySpent: () => ({ error: "spent" }) })),
      { q: "churn" },
    );
    expect(out.error).toBe("spent");
    expect(searchDigests).not.toHaveBeenCalled();
  });

  it("does not spend the shared read budget", async () => {
    const budgetSpent = vi.fn(() => ({ error: "read budget spent" }));
    searchDigests.mockResolvedValue([]);
    await run(createHistoryTool(makeCtx({ budgetSpent })), { q: "churn" });
    expect(budgetSpent).not.toHaveBeenCalled();
  });
});
