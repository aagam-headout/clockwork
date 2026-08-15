import type { ResultStore } from "../result-store";
import type { SignalDecl } from "@/lib/outcome/condition";
import type { Envelope } from "@/lib/outcome/envelope";

/**
 * What every system tool needs from the run.
 *
 * `query` and `inspect` share one budget and one payload store — this is the
 * seam a future system tool plugs into instead of reaching into
 * `wrap-tools.ts` for them directly.
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
   * The executor owns the slot rather than reading a return value, because the
   * agent loop swallows tool results — the value has to survive the loop for
   * the run to have an outcome at all.
   */
  setEnvelope: (envelope: Envelope) => void;
};
