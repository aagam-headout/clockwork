import { describe, expect, it, vi, beforeEach } from "vitest";

const select = vi.fn();
const insert = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => select(...args),
    insert: (...args: unknown[]) => insert(...args),
  },
}));

import { canonicalHash, readToolHash, writeToolHash } from "./tool-hashes";

/** Minimal stand-in for the drizzle builder chain, which is thenable. */
function selectChain(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}

function insertChain(result: Promise<unknown>) {
  return {
    values: () => ({ onConflictDoUpdate: () => result }),
  };
}

beforeEach(() => {
  select.mockReset();
  insert.mockReset();
});

describe("canonicalHash", () => {
  it("is stable across key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("is stable across nested key order", () => {
    expect(canonicalHash({ o: { a: 1, b: 2 } })).toBe(
      canonicalHash({ o: { b: 2, a: 1 } }),
    );
  });

  it("distinguishes different values", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
});

describe("readToolHash", () => {
  it("returns the stored hash and timestamp", async () => {
    const seenAt = new Date("2026-08-11T06:00:00Z");
    select.mockReturnValue(selectChain([{ resultHash: "abc", seenAt }]));

    await expect(
      readToolHash("w1", "GMAIL_FETCH_EMAILS", "args"),
    ).resolves.toEqual({ resultHash: "abc", seenAt });
  });

  it("returns null when there is no row", async () => {
    select.mockReturnValue(selectChain([]));
    await expect(readToolHash("w1", "T", "args")).resolves.toBeNull();
  });

  it("returns null when the database is unreachable", async () => {
    select.mockImplementation(() => {
      throw new Error("connection refused");
    });
    await expect(readToolHash("w1", "T", "args")).resolves.toBeNull();
  });
});

describe("writeToolHash", () => {
  it("does not throw when the write fails", async () => {
    insert.mockReturnValue(insertChain(Promise.reject(new Error("read-only"))));
    await expect(
      writeToolHash("w1", "T", "args", "hash"),
    ).resolves.toBeUndefined();
  });
});
