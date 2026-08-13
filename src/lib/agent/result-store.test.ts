import { describe, expect, it } from "vitest";
import {
  createResultStore,
  isDescriptor,
  MAX_DESCRIPTOR_CHARS,
} from "./result-store";

const bulk = (chars: number) => ({ blob: "x".repeat(chars) });

describe("createResultStore", () => {
  it("numbers handles in call order", () => {
    const store = createResultStore();
    const first = store.put("A_TOOL", { a: 1 }, '{"a":1}');
    const second = store.put("B_TOOL", { b: 2 }, '{"b":2}');
    expect(first.handle).toBe("r1");
    expect(second.handle).toBe("r2");
  });

  it("returns a descriptor carrying shape, size and sample", () => {
    const store = createResultStore();
    const descriptor = store.put(
      "GMAIL_FETCH_EMAILS",
      { items: [{ id: "1" }] },
      '{"items":[{"id":"1"}]}',
    );
    expect(descriptor.tool).toBe("GMAIL_FETCH_EMAILS");
    expect(descriptor.bytes).toBe(22);
    expect(descriptor.shape).toBe("{ items: [1 × {id}] }");
    expect(descriptor.sample).toContain('"id":"1"');
    expect(isDescriptor(descriptor)).toBe(true);
  });

  it("round-trips the payload", () => {
    const store = createResultStore();
    const { handle } = store.put("A", { deep: { value: 1 } }, "{}");
    expect(store.get(handle)).toEqual({
      ok: true,
      payload: { deep: { value: 1 } },
    });
  });

  it("names the available handles when one is unknown", () => {
    const store = createResultStore();
    store.put("A", {}, "{}");
    const out = store.get("r9");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("no such handle r9");
    expect(out.error).toContain("r1");
  });

  it("evicts the least recently used payload past the byte ceiling", () => {
    const store = createResultStore(1_000);
    const a = store.put("A", bulk(400), "x".repeat(400));
    const b = store.put("B", bulk(400), "x".repeat(400));

    // Touching `a` makes `b` the least recently used.
    expect(store.get(a.handle).ok).toBe(true);
    store.put("C", bulk(400), "x".repeat(400));

    expect(store.get(a.handle).ok).toBe(true);
    const evicted = store.get(b.handle);
    expect(evicted.ok).toBe(false);
    if (evicted.ok) return;
    expect(evicted.error).toContain("was evicted");
  });

  it("distinguishes an evicted handle from one that never existed", () => {
    const store = createResultStore(500);
    const a = store.put("A", bulk(400), "x".repeat(400));
    store.put("B", bulk(400), "x".repeat(400));

    const evicted = store.get(a.handle);
    const unknown = store.get("r99");
    expect(evicted.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (evicted.ok || unknown.ok) return;
    expect(evicted.error).toContain("evicted");
    expect(unknown.error).toContain("no such handle");
  });

  it("lists live handles", () => {
    const store = createResultStore();
    store.put("A", {}, "{}");
    store.put("B", {}, "{}");
    expect(store.handles()).toEqual(["r1", "r2"]);
  });

  it("allows a single payload larger than the ceiling to be retrieved immediately after put", () => {
    const store = createResultStore(500);
    const big = store.put("BIG", bulk(1000), "x".repeat(1000));
    expect(big.handle).toBe("r1");
    expect(big.bytes).toBe(1000);
    const result = store.get(big.handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual(bulk(1000));
  });

  it("evicts the older oversized entry when a new normal entry arrives", () => {
    const store = createResultStore(500);
    const big = store.put("BIG", bulk(1000), "x".repeat(1000));
    const normal = store.put("NORMAL", bulk(100), "x".repeat(100));
    expect(big.handle).toBe("r1");
    expect(normal.handle).toBe("r2");
    expect(store.get(normal.handle).ok).toBe(true);
    const bigAfter = store.get(big.handle);
    expect(bigAfter.ok).toBe(false);
    if (bigAfter.ok) return;
    expect(bigAfter.error).toContain("was evicted");
  });

  it("distinguishes evicted oversized entry from non-existent handle", () => {
    const store = createResultStore(500);
    const big = store.put("BIG", bulk(1000), "x".repeat(1000));
    store.put("NORMAL", bulk(100), "x".repeat(100));
    const evicted = store.get(big.handle);
    const unknown = store.get("r99");
    expect(evicted.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (evicted.ok || unknown.ok) return;
    expect(evicted.error).toContain("evicted");
    expect(unknown.error).toContain("no such handle");
  });
});

/*
 * The preview is what makes a routine digest cost zero `query` calls — each
 * of those is a whole model round trip, prompt and history included.
 */
describe("the descriptor's preview", () => {
  it("carries the first rows of the payload's main list", () => {
    const store = createResultStore();
    const payload = {
      items: Array.from({ length: 40 }, (_, i) => ({
        id: `${i}`,
        subject: `mail ${i}`,
      })),
    };
    const descriptor = store.put("GMAIL", payload, JSON.stringify(payload));
    expect(descriptor.preview_rows).toEqual([
      { id: "0", subject: "mail 0" },
      { id: "1", subject: "mail 1" },
      { id: "2", subject: "mail 2" },
    ]);
  });

  it("drops the preview rather than truncating a fat row", () => {
    const store = createResultStore();
    const payload = {
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        body: "y".repeat(2_000),
      })),
    };
    const descriptor = store.put("GMAIL", payload, JSON.stringify(payload));
    expect(descriptor.preview_rows).toBeUndefined();
  });

  it("keeps the whole descriptor under its ceiling", () => {
    const store = createResultStore();
    const payload = {
      items: Array.from({ length: 30 }, (_, i) => ({
        id: `${i}`,
        subject: "s".repeat(120),
        from: "someone@example.com",
      })),
    };
    const descriptor = store.put("GMAIL", payload, JSON.stringify(payload));
    expect(JSON.stringify(descriptor).length).toBeLessThanOrEqual(
      MAX_DESCRIPTOR_CHARS,
    );
  });

  it("keeps a pathological payload's descriptor small by shedding sample and shape", () => {
    const store = createResultStore();
    const payload = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`field_number_${i}`, i]),
    );
    const descriptor = store.put("WIDE", payload, JSON.stringify(payload));
    expect(JSON.stringify(descriptor).length).toBeLessThanOrEqual(
      MAX_DESCRIPTOR_CHARS,
    );
    expect(descriptor.handle).toBe("r1");
  });

  it("has no preview when there is no list to preview", () => {
    const store = createResultStore();
    const descriptor = store.put("A", { status: "ok" }, '{"status":"ok"}');
    expect(descriptor.preview_rows).toBeUndefined();
  });
});

describe("isDescriptor", () => {
  it("rejects ordinary tool output", () => {
    expect(isDescriptor({ successful: true, data: {} })).toBe(false);
    expect(isDescriptor(null)).toBe(false);
    expect(isDescriptor("r1")).toBe(false);
  });
});
