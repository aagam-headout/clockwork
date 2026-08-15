import { describe, expect, it, vi, beforeEach } from "vitest";

const executeRun = vi.fn();
const select = vi.fn();

const retryPendingDeliveries = vi.fn();

vi.mock("@/lib/executor", () => ({
  executeRun: (...args: unknown[]) => executeRun(...args),
  retryPendingDeliveries: (...args: unknown[]) =>
    retryPendingDeliveries(...args),
  runWorkflow: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: (...args: unknown[]) => select(...args) },
}));

vi.mock("@/lib/connection-gate", () => ({
  checkConnectionsWith: () => ({ ok: true }),
  requiredToolkits: async () => [],
}));

vi.mock("@/lib/data/connections", () => ({
  activeToolkitsByUser: async () => new Map(),
}));

vi.mock("@/lib/provider", () => ({
  getProviderForUser: async () => "gateway",
}));
vi.mock("@/lib/provider-keys", () => ({ hasProviderKey: async () => true }));

import { drainChainedRuns } from "./dispatcher";

/**
 * Minimal stand-in for the drizzle select chain the drain pass builds.
 * Everything up to `limit` is fluent; `limit` resolves.
 */
function chain(rows: unknown[]) {
  const link = {
    from: () => link,
    innerJoin: () => link,
    where: () => link,
    orderBy: () => link,
    limit: () => Promise.resolve(rows),
  };
  return link;
}

beforeEach(() => {
  executeRun.mockReset();
  select.mockReset();
  retryPendingDeliveries.mockReset().mockResolvedValue(0);
});

describe("drainChainedRuns", () => {
  it("executes a queued chained run", async () => {
    select
      .mockReturnValueOnce(chain([{ runId: "r1", slug: "child" }]))
      .mockReturnValueOnce(chain([]));
    executeRun.mockResolvedValue({ runId: "r1", status: "ok" });

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).toHaveBeenCalledWith("r1");
    expect(out).toEqual([
      { workflowId: "", slug: "child", status: "ok", runId: "r1" },
    ]);
  });

  it("keeps draining while rows remain", async () => {
    select
      .mockReturnValueOnce(chain([{ runId: "r1", slug: "a" }]))
      .mockReturnValueOnce(chain([{ runId: "r2", slug: "b" }]))
      .mockReturnValueOnce(chain([]));
    executeRun.mockResolvedValue({ status: "ok" });

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.runId)).toEqual(["r1", "r2"]);
  });

  it("stops when the tick budget is spent and leaves rows queued", async () => {
    select.mockReturnValue(chain([{ runId: "r1", slug: "child" }]));

    // A tick that started ten minutes ago is already past its 240s budget.
    const out = await drainChainedRuns(Date.now() - 10 * 60_000);

    expect(executeRun).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("keeps draining after one chained run fails to start", async () => {
    select
      .mockReturnValueOnce(chain([{ runId: "r1", slug: "a" }]))
      .mockReturnValueOnce(chain([{ runId: "r2", slug: "b" }]))
      .mockReturnValueOnce(chain([]));
    executeRun
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "ok" });

    const out = await drainChainedRuns(Date.now());

    // One bad row must not strand every chained run behind it.
    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(out[0].status).toBe("failed_to_start");
    expect(out[0].error).toBe("boom");
    expect(out[1].status).toBe("ok");
  });

  it("does nothing when there is no chained work", async () => {
    select.mockReturnValue(chain([]));

    expect(await drainChainedRuns(Date.now())).toEqual([]);
    expect(executeRun).not.toHaveBeenCalled();
  });
});

describe("delivery retry from the drain pass", () => {
  it("sweeps deliveries after the chain is drained", async () => {
    select.mockReturnValue(chain([]));

    await drainChainedRuns(Date.now());

    expect(retryPendingDeliveries).toHaveBeenCalledTimes(1);
  });

  it("hands the sweep a budget predicate that is still open", async () => {
    select.mockReturnValue(chain([]));

    await drainChainedRuns(Date.now());

    const budgetLeft = retryPendingDeliveries.mock.calls[0][0] as () => boolean;
    expect(budgetLeft()).toBe(true);
  });

  it("hands the sweep a spent predicate once the tick is over budget", async () => {
    select.mockReturnValue(chain([]));

    await drainChainedRuns(Date.now() - 10 * 60_000);

    const budgetLeft = retryPendingDeliveries.mock.calls[0][0] as () => boolean;
    expect(budgetLeft()).toBe(false);
  });

  it("keeps the dispatch results when the sweep throws", async () => {
    select.mockReturnValue(chain([]));
    retryPendingDeliveries.mockImplementation(() => {
      throw new Error("sweep exploded");
    });

    // A failing retry sweep must not lose what the tick already achieved.
    await expect(drainChainedRuns(Date.now())).resolves.toEqual([]);
  });
});
