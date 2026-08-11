import { getModelCatalogForUser } from "@/lib/models";

export type RunUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
};

/**
 * Actual USD for one run, from the gateway's live per-token prices. Cached
 * input tokens are billed at the cached rate when the model publishes one
 * and counted as ordinary input otherwise.
 *
 * Returns undefined when the model has no published pricing — a missing
 * number is honest, a zero would read as "this run was free".
 */
export async function runCostUsd(
  modelId: string,
  usage: RunUsage | undefined,
  /** Workflow owner — whose provider, and whose key, priced this run. */
  userId: string,
): Promise<number | undefined> {
  if (!usage) return undefined;

  const catalog = await getModelCatalogForUser(userId);
  const model = catalog.find((m) => m.id === modelId);
  if (!model || model.inputPerM == null || model.outputPerM == null) {
    return undefined;
  }

  const cached = usage.cachedInputTokens ?? 0;
  // Providers report cached tokens as a subset of input tokens, so the
  // uncached remainder is what's left after subtracting them.
  const uncachedInput = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const cachedPerM = model.cachedInputPerM ?? model.inputPerM;

  return (
    (uncachedInput * model.inputPerM +
      cached * cachedPerM +
      (usage.outputTokens ?? 0) * model.outputPerM) /
    1_000_000
  );
}

/** Postgres `numeric(10,6)` takes a string; anything smaller than a µ$ is 0. */
export function toCostColumn(usd: number | undefined): string | null {
  return usd == null ? null : usd.toFixed(6);
}
