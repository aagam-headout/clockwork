import { describe, expect, it } from "vitest";
import { decideDelivery, decideChildren } from "./route";
import type { Envelope } from "./envelope";
import type { SignalDecl } from "./condition";

const declared: SignalDecl[] = [{ key: "n", type: "number" }];

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    digest: "## digest",
    signals: { n: 10 },
    severity: null,
    noUpdates: false,
    ...over,
  };
}

describe("decideDelivery", () => {
  it("delivers when there is no condition", () => {
    expect(decideDelivery(envelope(), null, declared)).toEqual({
      deliver: true,
      suppressed: false,
      suppressedReason: null,
    });
  });

  it("treats a blank condition as no condition", () => {
    expect(decideDelivery(envelope(), "   ", declared).deliver).toBe(true);
  });

  it("delivers when the condition holds", () => {
    expect(decideDelivery(envelope(), "n > 3", declared).deliver).toBe(true);
  });

  it("suppresses when the condition does not hold", () => {
    const out = decideDelivery(
      envelope({ signals: { n: 1 } }),
      "n > 3",
      declared,
    );
    expect(out).toEqual({
      deliver: false,
      suppressed: true,
      suppressedReason: "alert condition not met: n > 3",
    });
  });

  it("DELIVERS an indeterminate condition and says so", () => {
    const out = decideDelivery(envelope({ signals: {} }), "n > 3", declared);
    expect(out.deliver).toBe(true);
    expect(out.suppressed).toBe(false);
    expect(out.suppressedReason).toBe("condition_indeterminate");
  });

  it("DELIVERS when the condition cannot be parsed, and says so", () => {
    const out = decideDelivery(envelope(), "bogus > 3", declared);
    expect(out.deliver).toBe(true);
    expect(out.suppressed).toBe(false);
    expect(out.suppressedReason).toMatch(/^condition_error/);
  });

  it("never delivers a no_updates envelope", () => {
    const out = decideDelivery(envelope({ noUpdates: true }), null, declared);
    expect(out.deliver).toBe(false);
    expect(out.suppressed).toBe(false);
    expect(out.suppressedReason).toBe(null);
  });

  it("does not evaluate the condition for a no_updates envelope", () => {
    // A broken condition must not turn a quiet run into a delivery.
    const out = decideDelivery(
      envelope({ noUpdates: true }),
      "bogus > 3",
      declared,
    );
    expect(out.deliver).toBe(false);
  });
});

describe("decideChildren", () => {
  const kids = [
    { id: "always", parentCondition: null },
    { id: "gated", parentCondition: "n > 3" },
  ];

  it("fires unconditional children", () => {
    const out = decideChildren(envelope({ signals: { n: 1 } }), declared, kids);
    expect(out.fire.map((c) => c.id)).toEqual(["always"]);
  });

  it("fires a gated child when its condition holds", () => {
    const out = decideChildren(envelope(), declared, kids);
    expect(out.fire.map((c) => c.id)).toEqual(["always", "gated"]);
  });

  it("records why a child was skipped", () => {
    const out = decideChildren(envelope({ signals: { n: 1 } }), declared, kids);
    expect(out.skipped).toEqual([
      { child: kids[1], reason: "parent condition not met: n > 3" },
    ]);
  });

  it("fires a gated child on an indeterminate condition", () => {
    const out = decideChildren(envelope({ signals: {} }), declared, kids);
    expect(out.fire.map((c) => c.id)).toEqual(["always", "gated"]);
  });

  it("fires a gated child whose condition does not parse", () => {
    const out = decideChildren(envelope(), declared, [
      { id: "broken", parentCondition: "bogus > 3" },
    ]);
    expect(out.fire.map((c) => c.id)).toEqual(["broken"]);
  });

  it("fires no children for a no_updates envelope", () => {
    const out = decideChildren(envelope({ noUpdates: true }), declared, kids);
    expect(out.fire).toEqual([]);
    expect(out.skipped.map((s) => s.reason)).toEqual([
      "parent reported no updates",
      "parent reported no updates",
    ]);
  });

  it("handles a workflow with no children", () => {
    expect(decideChildren(envelope(), declared, [])).toEqual({
      fire: [],
      skipped: [],
    });
  });
});
