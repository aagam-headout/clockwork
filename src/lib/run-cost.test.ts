import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "./model-tiers";

const CATALOG: ModelInfo[] = [
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "anthropic",
    inputPerM: 3,
    outputPerM: 15,
    cachedInputPerM: 0.3,
    tier: "mid",
  },
  {
    id: "vendor/unpriced",
    name: "Unpriced",
    provider: "vendor",
    tier: "mid",
  },
];

vi.mock("@/lib/models", () => ({
  getModelCatalog: async () => CATALOG,
}));

const { runCostUsd, toCostColumn } = await import("./run-cost");

describe("runCostUsd", () => {
  it("prices input and output separately", async () => {
    const cost = await runCostUsd("anthropic/claude-sonnet-5", {
      inputTokens: 20_000,
      outputTokens: 1_000,
    });
    // 20k * $3/M + 1k * $15/M
    expect(cost).toBeCloseTo(0.06 + 0.015, 10);
  });

  it("bills cached input at the cached rate", async () => {
    const cost = await runCostUsd("anthropic/claude-sonnet-5", {
      inputTokens: 20_000,
      cachedInputTokens: 10_000,
      outputTokens: 0,
    });
    // 10k uncached at $3/M + 10k cached at $0.30/M
    expect(cost).toBeCloseTo(0.03 + 0.003, 10);
  });

  it("returns undefined rather than a misleading zero", async () => {
    expect(
      await runCostUsd("vendor/unpriced", {
        inputTokens: 100,
        outputTokens: 5,
      }),
    ).toBeUndefined();
    expect(await runCostUsd("nope/nope", { inputTokens: 1 })).toBeUndefined();
    expect(
      await runCostUsd("anthropic/claude-sonnet-5", undefined),
    ).toBeUndefined();
  });
});

describe("toCostColumn", () => {
  it("formats for numeric(10,6) and keeps null null", () => {
    expect(toCostColumn(0.075)).toBe("0.075000");
    expect(toCostColumn(undefined)).toBeNull();
  });
});
