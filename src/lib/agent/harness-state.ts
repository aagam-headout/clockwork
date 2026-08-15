import { writeToolHash } from "@/lib/data/tool-hashes";

export type PendingHash = {
  toolSlug: string;
  argsHash: string;
  resultHash: string;
};

/**
 * What the wrapper learned during a run that only the executor can act on.
 *
 * Owned by the caller rather than returned, so the wrapper's public shape
 * stays "a ToolSet in, a ToolSet out" and the executor can read this after
 * the loop has finished — including on the paths where it never finished.
 */
export type HarnessState = {
  /**
   * Hashes for calls made this run, held until the run's verdict is known.
   *
   * Writing one inline would be a lie waiting to happen: if the run then dies
   * — auth rejected, timeout, step cap — the hash says "the workflow has seen
   * these bytes" while no digest ever carried them. The next run fetches the
   * same bytes, is told `unchanged_since`, reports nothing new, and the
   * content is lost for good. Only a run that reached a delivered digest has
   * earned the right to claim it saw the data.
   */
  pendingHashes: PendingHash[];
  /**
   * Reads the model asked for and did not get — a spent query budget or an
   * evicted handle. Both are returned to the model as ordinary error values,
   * so without a counter here the run looks identical to one that read
   * everything it wanted, and gets recorded as a clean `ok`.
   */
  degradedReads: number;
  /**
   * `history` calls made this run.
   *
   * Its own counter rather than the shared read budget: a spent read budget
   * marks a run degraded because the model could not see data it fetched, and
   * a history lookup it chose not to make is not that. Exhausting this is the
   * model spending an allowance, not a failure to report.
   */
  historyCalls: number;
};

export function createHarnessState(): HarnessState {
  return { pendingHashes: [], degradedReads: 0, historyCalls: 0 };
}

/**
 * Commits the run's hashes. Call only where the run is recorded as a clean
 * `ok` — see `HarnessState.pendingHashes` for why anywhere else is a bug.
 */
export async function flushToolHashes(
  workflowId: string,
  state: HarnessState,
): Promise<void> {
  const pending = state.pendingHashes.splice(0);
  await Promise.all(
    pending.map((hash) =>
      writeToolHash(workflowId, hash.toolSlug, hash.argsHash, hash.resultHash),
    ),
  );
}
