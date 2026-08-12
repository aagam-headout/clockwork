import { describe, expect, it } from "vitest";
import { describeShape, previewRows, sampleOf } from "./shape";

describe("describeShape", () => {
  it("describes an object of scalars", () => {
    expect(describeShape({ id: "a", count: 2, ok: true })).toBe(
      "{ id: string, count: number, ok: boolean }",
    );
  });

  it("describes an array of uniform objects with its length", () => {
    const items = Array.from({ length: 142 }, (_, i) => ({
      id: `id-${i}`,
      from: "a@b.c",
      date: "2026-08-11",
    }));
    expect(describeShape({ items })).toBe("{ items: [142 × {id,from,date}] }");
  });

  it("unions the keys when array elements disagree", () => {
    const value = [{ a: 1 }, { b: 2 }];
    expect(describeShape(value)).toBe("[2 × {a,b}]");
  });

  it("describes an array of scalars by element type", () => {
    expect(describeShape(["x", "y"])).toBe("[2 × string]");
  });

  it("describes an empty array without inventing an element type", () => {
    expect(describeShape({ items: [] })).toBe("{ items: [0] }");
  });

  it("describes nulls and nested objects", () => {
    expect(describeShape({ page: { next: null } })).toBe(
      "{ page: { next: null } }",
    );
  });

  it("stops descending past the depth limit", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(describeShape(deep)).toBe("{ a: { b: { c: { d: object } } } }");
  });

  it("describes a bare primitive", () => {
    expect(describeShape("hello")).toBe("string");
    expect(describeShape(null)).toBe("null");
  });
});

describe("sampleOf", () => {
  it("returns the whole value when it is short", () => {
    expect(sampleOf({ a: 1 })).toBe('{"a":1}');
  });

  it("truncates to the requested length with an ellipsis", () => {
    const long = { text: "x".repeat(500) };
    const out = sampleOf(long, 50);
    expect(out).toHaveLength(51); // 50 characters plus the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("never throws on a circular value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sampleOf(circular)).toBe("<unserialisable>");
  });
});

describe("previewRows", () => {
  it("takes the first rows of the only list", () => {
    const rows = previewRows({
      items: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }],
    });
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("prefers the longest list, which is the payload's subject", () => {
    const rows = previewRows({
      labels: [{ name: "inbox" }],
      messages: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }],
    });
    expect(rows).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("steps down the row count to stay inside the cap", () => {
    const rows = previewRows({
      items: Array.from({ length: 10 }, () => ({ body: "y".repeat(250) })),
    });
    expect(rows).toHaveLength(2);
  });

  it("drops the preview entirely rather than cutting a row in half", () => {
    const rows = previewRows({
      items: Array.from({ length: 10 }, () => ({ body: "y".repeat(1_000) })),
    });
    expect(rows).toBeUndefined();
  });

  it("has nothing to preview without a list", () => {
    expect(previewRows({ status: "ok" })).toBeUndefined();
    expect(previewRows({ items: [] })).toBeUndefined();
    expect(previewRows("a string")).toBeUndefined();
  });

  it("never throws on a circular payload", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(previewRows({ items: [circular] })).toBeUndefined();
  });
});
