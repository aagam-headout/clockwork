import { describe, expect, it, vi } from "vitest";
import { createReportTool } from "./report";
import type { SystemToolContext } from "./context";
import type { Envelope } from "@/lib/outcome/envelope";

function makeCtx(signals: SystemToolContext["signals"] = []) {
  const captured: Envelope[] = [];
  const ctx = {
    store: {} as never,
    budgetSpent: () => null,
    markDegraded: vi.fn(),
    signals,
    setEnvelope: (envelope: Envelope) => captured.push(envelope),
  } satisfies SystemToolContext;
  return { ctx, captured };
}

async function run(tool: ReturnType<typeof createReportTool>, input: unknown) {
  // The AI SDK passes (input, options); nothing here reads options.
  return (await tool.execute?.(input as never, {} as never)) as {
    ok?: boolean;
    error?: string;
  };
}

describe("report tool", () => {
  it("captures a plain digest", async () => {
    const { ctx, captured } = makeCtx();
    const out = await run(createReportTool(ctx), { digest: "## hello" });
    expect(out.ok).toBe(true);
    expect(captured[0].digest).toBe("## hello");
    expect(captured[0].noUpdates).toBe(false);
  });

  it("captures no_updates", async () => {
    const { ctx, captured } = makeCtx();
    await run(createReportTool(ctx), { no_updates: true });
    expect(captured[0].noUpdates).toBe(true);
    expect(captured[0].digest).toBe("");
  });

  it("captures declared signals", async () => {
    const { ctx, captured } = makeCtx([{ key: "n", type: "number" }]);
    await run(createReportTool(ctx), { digest: "d", signals: { n: 4 } });
    expect(captured[0].signals).toEqual({ n: 4 });
  });

  it("captures severity", async () => {
    const { ctx, captured } = makeCtx();
    await run(createReportTool(ctx), { digest: "d", severity: "critical" });
    expect(captured[0].severity).toBe("critical");
  });

  it("returns an error the model can act on for a bad signal", async () => {
    const { ctx, captured } = makeCtx([{ key: "n", type: "number" }]);
    const out = await run(createReportTool(ctx), {
      digest: "d",
      signals: { n: "four" },
    });
    expect(out.error).toMatch(/must be a number/);
    expect(captured).toHaveLength(0);
  });

  it("returns an error when neither digest nor no_updates is given", async () => {
    const { ctx, captured } = makeCtx();
    const out = await run(createReportTool(ctx), {});
    expect(out.error).toMatch(/digest/);
    expect(captured).toHaveLength(0);
  });

  it("keeps the last report when called twice", async () => {
    const { ctx, captured } = makeCtx();
    const tool = createReportTool(ctx);
    await run(tool, { digest: "first" });
    await run(tool, { digest: "second" });
    expect(captured).toHaveLength(2);
    expect(captured[1].digest).toBe("second");
  });

  it("does not spend the shared read budget", async () => {
    const budgetSpent = vi.fn(() => ({ error: "budget spent" }));
    const ctx = {
      store: {} as never,
      budgetSpent,
      markDegraded: vi.fn(),
      signals: [],
      setEnvelope: () => {},
    } satisfies SystemToolContext;
    const out = await run(createReportTool(ctx), { digest: "d" });
    expect(budgetSpent).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });

  it("names the declared signals in its description", () => {
    const { ctx } = makeCtx([
      { key: "mrr_delta_pct", type: "number" },
      { key: "is_incident", type: "boolean" },
    ]);
    expect(createReportTool(ctx).description).toContain(
      "mrr_delta_pct (number)",
    );
  });
});
