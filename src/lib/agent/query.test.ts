import { describe, expect, it } from "vitest";
import { runQuery } from "./query";

const payload = {
  items: [
    { id: "1", from: "a@x.com", subject: "Invoice", date: "2026-08-10" },
    { id: "2", from: "b@y.com", subject: "Receipt", date: "2026-08-12" },
    { id: "3", from: "c@z.com", subject: "Invoice copy", date: "2026-08-11" },
  ],
  nextPageToken: "abc",
};

describe("runQuery", () => {
  it("walks a dot path", () => {
    const out = runQuery({ a: { b: 7 } }, { path: "a.b" });
    expect(out).toEqual({ ok: true, value: 7 });
  });

  it("picks fields from every element", () => {
    const out = runQuery(payload, { path: "items", pick: ["id", "subject"] });
    expect(out).toEqual({
      ok: true,
      value: [
        { id: "1", subject: "Invoice" },
        { id: "2", subject: "Receipt" },
        { id: "3", subject: "Invoice copy" },
      ],
    });
  });

  it("picks fields from a single object", () => {
    const out = runQuery({ a: 1, b: 2 }, { pick: ["a"] });
    expect(out).toEqual({ ok: true, value: { a: 1 } });
  });

  it("filters with equals", () => {
    const out = runQuery(payload, {
      path: "items",
      where: { field: "from", equals: "b@y.com" },
      pick: ["id"],
    });
    expect(out).toEqual({ ok: true, value: [{ id: "2" }] });
  });

  it("filters with contains, case-insensitively", () => {
    const out = runQuery(payload, {
      path: "items",
      where: { field: "subject", contains: "invoice" },
      pick: ["id"],
    });
    expect(out).toEqual({ ok: true, value: [{ id: "1" }, { id: "3" }] });
  });

  it("filters with after and before on ISO dates", () => {
    expect(
      runQuery(payload, {
        path: "items",
        where: { field: "date", after: "2026-08-10" },
        pick: ["id"],
      }),
    ).toEqual({ ok: true, value: [{ id: "2" }, { id: "3" }] });

    expect(
      runQuery(payload, {
        path: "items",
        where: { field: "date", before: "2026-08-11" },
        pick: ["id"],
      }),
    ).toEqual({ ok: true, value: [{ id: "1" }] });
  });

  it("sorts descending and takes", () => {
    const out = runQuery(payload, {
      path: "items",
      sort: { field: "date", direction: "desc" },
      take: 1,
      pick: ["id"],
    });
    expect(out).toEqual({ ok: true, value: [{ id: "2" }] });
  });

  it("counts instead of returning rows", () => {
    const out = runQuery(payload, { path: "items", count: true });
    expect(out).toEqual({ ok: true, value: { count: 3 } });
  });

  it("counts after filtering", () => {
    const out = runQuery(payload, {
      path: "items",
      where: { field: "subject", contains: "invoice" },
      count: true,
    });
    expect(out).toEqual({ ok: true, value: { count: 2 } });
  });

  it("returns an empty array when nothing matches", () => {
    const out = runQuery(payload, {
      path: "items",
      where: { field: "from", equals: "nobody@nowhere" },
    });
    expect(out).toEqual({ ok: true, value: [] });
  });

  it("reports an unknown path with the shape it did find", () => {
    const out = runQuery(payload, { path: "messages" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("messages");
    expect(out.shapeAtPath).toContain("items");
  });

  it("reports filtering on a field no element has", () => {
    const out = runQuery(payload, {
      path: "items",
      where: { field: "sender", equals: "x" },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("sender");
    expect(out.shapeAtPath).toContain("from");
  });

  it("reports where used against a non-array", () => {
    const out = runQuery(payload, {
      path: "nextPageToken",
      where: { field: "a", equals: "b" },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("not a list");
  });

  it("ignores pick fields an element lacks rather than emitting undefined", () => {
    const out = runQuery(
      { rows: [{ a: 1 }] },
      { path: "rows", pick: ["a", "missing"] },
    );
    expect(out).toEqual({ ok: true, value: [{ a: 1 }] });
  });

  it("excludes rows with null field from before filter", () => {
    const out = runQuery(
      {
        items: [
          { id: "1", date: null },
          { id: "2", date: "2026-08-12" },
        ],
      },
      {
        path: "items",
        where: { field: "date", before: "2026-08-11" },
        pick: ["id"],
      },
    );
    expect(out).toEqual({ ok: true, value: [] });
  });

  it("excludes rows with null field from after filter", () => {
    const out = runQuery(
      {
        items: [
          { id: "1", date: null },
          { id: "2", date: "2026-08-09" },
        ],
      },
      {
        path: "items",
        where: { field: "date", after: "2026-08-10" },
        pick: ["id"],
      },
    );
    expect(out).toEqual({ ok: true, value: [] });
  });

  it("excludes rows with missing field from before filter", () => {
    const out = runQuery(
      { items: [{ id: "1" }, { id: "2", date: "2026-08-12" }] },
      {
        path: "items",
        where: { field: "date", before: "2026-08-11" },
        pick: ["id"],
      },
    );
    expect(out).toEqual({ ok: true, value: [] });
  });

  it("excludes rows with missing field from after filter", () => {
    const out = runQuery(
      { items: [{ id: "1" }, { id: "2", date: "2026-08-09" }] },
      {
        path: "items",
        where: { field: "date", after: "2026-08-10" },
        pick: ["id"],
      },
    );
    expect(out).toEqual({ ok: true, value: [] });
  });
});

/*
 * `in` walks the prototype chain, so before this a path of "constructor"
 * resolved to a function and the agent got JS internals back as if they were
 * fetched data.
 */
describe("prototype keys are not data", () => {
  it("refuses a path onto the prototype chain", () => {
    const out = runQuery({ items: [] }, { path: "constructor" });
    expect(out.ok).toBe(false);
  });

  it("refuses a nested prototype path", () => {
    const out = runQuery({ a: { b: 1 } }, { path: "a.toString" });
    expect(out.ok).toBe(false);
  });

  it("does not treat an inherited key as a filterable field", () => {
    const out = runQuery(
      { items: [{ id: "1" }] },
      { path: "items", where: { field: "constructor", contains: "Object" } },
    );
    expect(out.ok).toBe(false);
  });

  it("does not project an inherited key", () => {
    const out = runQuery(
      { items: [{ id: "1" }] },
      {
        path: "items",
        pick: ["id", "toString"],
      },
    );
    expect(out).toEqual({ ok: true, value: [{ id: "1" }] });
  });
});
