import { describe, expect, it } from "vitest";
import { validateChain, chainDepth } from "./chain";
import type { ChainNode } from "./chain";

// a -> b -> c   (a is the root; c is deepest)
const nodes: ChainNode[] = [
  { id: "a", parentWorkflowId: null },
  { id: "b", parentWorkflowId: "a" },
  { id: "c", parentWorkflowId: "b" },
];

describe("chainDepth", () => {
  it("counts a root as depth 1", () => {
    expect(chainDepth("a", nodes)).toBe(1);
  });

  it("counts a child as depth 2", () => {
    expect(chainDepth("b", nodes)).toBe(2);
  });

  it("counts a grandchild as depth 3", () => {
    expect(chainDepth("c", nodes)).toBe(3);
  });

  it("terminates on a corrupt cycle rather than looping forever", () => {
    const cyclic: ChainNode[] = [
      { id: "x", parentWorkflowId: "y" },
      { id: "y", parentWorkflowId: "x" },
    ];
    expect(chainDepth("x", cyclic)).toBeLessThan(10);
  });
});

describe("validateChain", () => {
  it("allows a new child of a root", () => {
    expect(validateChain(null, "a", nodes)).toEqual({ ok: true });
  });

  it("allows clearing the parent", () => {
    expect(validateChain("b", null, nodes)).toEqual({ ok: true });
  });

  it("rejects a workflow parenting itself", () => {
    const out = validateChain("b", "b", nodes);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/itself/);
  });

  it("rejects a direct cycle", () => {
    // making a a child of b closes a <-> b
    const out = validateChain("a", "b", nodes);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/cycle/i);
  });

  it("rejects an indirect cycle", () => {
    // making a a child of c closes a -> b -> c -> a
    const out = validateChain("a", "c", nodes);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/cycle/i);
  });

  it("rejects exceeding the depth limit", () => {
    // default maxChainDepth is 3; a child of c would be depth 4
    const out = validateChain(null, "c", nodes);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/deep/i);
  });

  it("rejects a parent that does not exist", () => {
    const out = validateChain(null, "zzz", nodes);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/not found/i);
  });

  it("rejects exceeding the fan-out limit", () => {
    const wide: ChainNode[] = [
      { id: "p", parentWorkflowId: null },
      { id: "k1", parentWorkflowId: "p" },
      { id: "k2", parentWorkflowId: "p" },
      { id: "k3", parentWorkflowId: "p" },
    ];
    const out = validateChain(null, "p", wide);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/children/i);
  });

  it("does not count the workflow being edited against its own fan-out", () => {
    const wide: ChainNode[] = [
      { id: "p", parentWorkflowId: null },
      { id: "k1", parentWorkflowId: "p" },
      { id: "k2", parentWorkflowId: "p" },
      { id: "k3", parentWorkflowId: "p" },
    ];
    // k3 re-saving with the same parent must not be rejected
    expect(validateChain("k3", "p", wide)).toEqual({ ok: true });
  });
});
