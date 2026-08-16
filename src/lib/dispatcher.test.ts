import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const executeRun = vi.fn();
const retryPendingDeliveries = vi.fn();
const hasProviderKey = vi.fn();

/** Result sets the chained-run query answers with, oldest call first. */
let chainBatches: unknown[][] = [];
/** What the owner lookup finds, or undefined for an account that is gone. */
let account: { status: string } | undefined;
/** Predicates the chained-run query was built with, in call order. */
let wheres: unknown[] = [];
/** Values written by `db.update`, so a settled row can be asserted on. */
let updates: Record<string, unknown>[] = [];

/**
 * Minimal stand-in for the drizzle chains the drain pass builds.
 *
 * Table-aware, not call-ordered: the pass makes two different queries (the
 * chained rows, and the owner behind them), and a mock keyed on call order
 * would break whenever either one moves.
 */
function link() {
  let table = "";
  const chain = {
    from: (t: unknown) => {
      table = getTableName(t as Parameters<typeof getTableName>[0]);
      return chain;
    },
    innerJoin: () => chain,
    where: (predicate: unknown) => {
      if (table === "runs") wheres.push(predicate);
      return chain;
    },
    orderBy: () => chain,
    limit: () =>
      Promise.resolve(
        table === "users"
          ? account
            ? [account]
            : []
          : (chainBatches.shift() ?? []),
      ),
  };
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => link(),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

vi.mock("@/lib/executor", () => ({
  executeRun: (...args: unknown[]) => executeRun(...args),
  retryPendingDeliveries: (...args: unknown[]) =>
    retryPendingDeliveries(...args),
  runWorkflow: vi.fn(),
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
vi.mock("@/lib/provider-keys", () => ({
  hasProviderKey: (...args: unknown[]) => hasProviderKey(...args),
}));

import { drainChainedRuns, interleaveByOwner } from "./dispatcher";

/**
 * Whether a built predicate carries `value` anywhere in it.
 *
 * Walked, not stringified: a drizzle condition holds references back to the
 * table it was built from, so `JSON.stringify` on one is circular.
 */
function mentions(node: unknown, value: string): boolean {
  const seen = new Set<unknown>();
  const stack = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === value) return true;
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...Object.values(current));
  }
  return false;
}

/** A queued chained row as the drain query returns it. */
function row(runId: string, slug = runId, userId = "u1") {
  return { runId, slug, userId };
}

beforeEach(() => {
  executeRun.mockReset().mockResolvedValue({ status: "ok" });
  retryPendingDeliveries.mockReset().mockResolvedValue(0);
  hasProviderKey.mockReset().mockResolvedValue(true);
  chainBatches = [];
  account = { status: "active" };
  wheres = [];
  updates = [];
});

describe("drainChainedRuns", () => {
  it("executes a queued chained run", async () => {
    chainBatches = [[row("r1", "child")], []];

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).toHaveBeenCalledWith("r1");
    expect(out).toEqual([
      { workflowId: "", slug: "child", status: "ok", runId: "r1" },
    ]);
  });

  it("keeps draining while rows remain", async () => {
    chainBatches = [[row("r1", "a")], [row("r2", "b")], []];

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.runId)).toEqual(["r1", "r2"]);
  });

  it("stops when the tick budget is spent and leaves rows queued", async () => {
    chainBatches = [[row("r1", "child")]];

    // A tick that started ten minutes ago is already past its 240s budget.
    const out = await drainChainedRuns(Date.now() - 10 * 60_000);

    expect(executeRun).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("keeps draining after one chained run fails to start", async () => {
    chainBatches = [[row("r1", "a"), row("r2", "b")], []];
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

  it("excludes rows it already attempted from the next query", async () => {
    // A run whose CLAIM threw is still `queued`. Without the exclusion the
    // next pass selects the same row and the loop spins on it until the tick
    // budget runs out.
    chainBatches = [[row("r1", "a")], []];
    executeRun.mockRejectedValueOnce(new Error("connection lost"));

    await drainChainedRuns(Date.now());

    expect(wheres).toHaveLength(2);
    expect(mentions(wheres[0], "r1")).toBe(false);
    expect(mentions(wheres[1], "r1")).toBe(true);
  });

  it("does nothing when there is no chained work", async () => {
    chainBatches = [[]];

    expect(await drainChainedRuns(Date.now())).toEqual([]);
    expect(executeRun).not.toHaveBeenCalled();
  });
});

describe("chained runs an account may not spend on", () => {
  it("does not run a chained row for a suspended owner", async () => {
    chainBatches = [[row("r1", "child")], []];
    account = { status: "suspended" };

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).not.toHaveBeenCalled();
    expect(out[0].status).toBe("owner_inactive");
  });

  it("does not run a chained row for an owner with no provider key", async () => {
    chainBatches = [[row("r1", "child")], []];
    hasProviderKey.mockResolvedValue(false);

    const out = await drainChainedRuns(Date.now());

    expect(executeRun).not.toHaveBeenCalled();
    expect(out[0].status).toBe("no_provider_key");
  });

  it("settles the row rather than leaving it queued forever", async () => {
    // Left queued, it holds the workflow's slot in the one-active-run index
    // and is re-read on every tick until the reaper takes it an hour later.
    chainBatches = [[row("r1", "child")], []];
    account = { status: "suspended" };

    await drainChainedRuns(Date.now());

    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("error");
    expect(updates[0].errorCode).toBe("owner_inactive");
  });

  it("asks about an owner once however many rows they have", async () => {
    chainBatches = [[row("r1", "a"), row("r2", "b"), row("r3", "c")], []];

    await drainChainedRuns(Date.now());

    expect(hasProviderKey).toHaveBeenCalledTimes(1);
    expect(executeRun).toHaveBeenCalledTimes(3);
  });
});

describe("interleaveByOwner", () => {
  it("alternates between owners rather than draining one first", () => {
    const rows = [
      { id: "a1", userId: "a" },
      { id: "a2", userId: "a" },
      { id: "a3", userId: "a" },
      { id: "b1", userId: "b" },
    ];

    expect(interleaveByOwner(rows).map((r) => r.id)).toEqual([
      "a1",
      "b1",
      "a2",
      "a3",
    ]);
  });

  it("keeps each owner's rows in the order they arrived", () => {
    const rows = [
      { id: "a1", userId: "a" },
      { id: "b1", userId: "b" },
      { id: "a2", userId: "a" },
      { id: "b2", userId: "b" },
    ];

    expect(interleaveByOwner(rows).map((r) => r.id)).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
    ]);
  });

  it("groups ownerless rows together rather than dropping them", () => {
    const rows = [
      { id: "x", userId: null },
      { id: "y", userId: null },
    ];

    expect(interleaveByOwner(rows).map((r) => r.id)).toEqual(["x", "y"]);
  });

  it("returns an empty list unchanged", () => {
    expect(interleaveByOwner([])).toEqual([]);
  });
});

describe("delivery retry from the drain pass", () => {
  beforeEach(() => {
    chainBatches = [[]];
  });

  it("sweeps deliveries after the chain is drained", async () => {
    await drainChainedRuns(Date.now());

    expect(retryPendingDeliveries).toHaveBeenCalledTimes(1);
  });

  it("hands the sweep a budget predicate that is still open", async () => {
    await drainChainedRuns(Date.now());

    const budgetLeft = retryPendingDeliveries.mock.calls[0][0] as () => boolean;
    expect(budgetLeft()).toBe(true);
  });

  it("hands the sweep a spent predicate once the tick is over budget", async () => {
    await drainChainedRuns(Date.now() - 10 * 60_000);

    const budgetLeft = retryPendingDeliveries.mock.calls[0][0] as () => boolean;
    expect(budgetLeft()).toBe(false);
  });

  it("keeps the dispatch results when the sweep throws", async () => {
    retryPendingDeliveries.mockImplementation(() => {
      throw new Error("sweep exploded");
    });

    // A failing retry sweep must not lose what the tick already achieved.
    await expect(drainChainedRuns(Date.now())).resolves.toEqual([]);
  });
});
