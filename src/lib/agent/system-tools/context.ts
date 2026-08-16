import type { ResultStore } from "../result-store";
import type { SignalDecl } from "@/lib/outcome/condition";
import type { Envelope } from "@/lib/outcome/envelope";

/**
 * What every system tool needs from the run.
 *
 * `query` and `inspect` share one budget and one payload store — the seam a
 * future system tool plugs into instead of reaching into `wrap-tools.ts`.
 */
export type SystemToolContext = {
  store: ResultStore;
  /** Shared per-run gate: the reading tools spend from the same budget. */
  budgetSpent: () => { error: string } | null;
  /** Flags a read the model asked for and did not get — an evicted handle. */
  markDegraded: () => void;
  /** What this workflow's `report` call may fill. Empty means digest only. */
  signals: SignalDecl[];
  /**
   * Where `report` deposits the run's outcome.
   *
   * The executor owns the slot rather than reading a return value: the agent
   * loop swallows tool results, so the value must survive it another way.
   */
  setEnvelope: (envelope: Envelope) => void;
  /** Whose digests `history` may read. Never taken from a tool argument. */
  ownerId: string;
  /** The workflow being run — the default scope for `history`. */
  workflowId: string;
  /** History's own budget, separate from the shared read budget. */
  historySpent: () => { error: string } | null;
};
