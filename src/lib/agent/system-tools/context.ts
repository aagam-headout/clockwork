import type { ResultStore } from "../result-store";

/**
 * What every system tool needs from the run.
 *
 * `query` and `inspect` share one budget and one payload store — this is the
 * seam a future system tool plugs into instead of reaching into
 * `wrap-tools.ts` for them directly.
 */
export type SystemToolContext = {
  store: ResultStore;
  /** Shared per-run gate: every system tool spends from the same budget. */
  budgetSpent: () => { error: string } | null;
  /** Flags a read the model asked for and did not get — an evicted handle. */
  markDegraded: () => void;
};
