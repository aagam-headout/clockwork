import { describe, expect, it, vi } from "vitest";

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

/*
 * The failing-search case lives in its own file.
 *
 * Vitest attributes an error thrown inside a mock implementation to the test
 * that triggered it, even when the code under test caught the error and
 * returned normally — but only once that same mock has been used by an earlier
 * test in the file. A dedicated mock with no prior interaction reports what
 * actually happened, which is what this asserts.
 */
describe("history tool when the search fails", () => {
  it("returns an error to the model instead of taking the run down", async () => {
    searchDigests.mockImplementation(() => {
      throw new Error("db down");
    });

    const tool = createHistoryTool({
      store: {} as never,
      budgetSpent: () => null,
      markDegraded: vi.fn(),
      signals: [],
      setEnvelope: vi.fn(),
      ownerId: "user-1",
      workflowId: "wf-1",
      historySpent: () => null,
    });

    const out = (await tool.execute?.(
      { q: "churn" } as never,
      {} as never,
    )) as {
      error?: string;
    };

    // History is supporting context, not the work: the run continues.
    expect(out.error).toMatch(/history is unavailable/i);
  });
});
