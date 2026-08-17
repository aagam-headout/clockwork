import { describe, expect, it } from "vitest";
import {
  buildReportSchema,
  normalizeEnvelope,
  parseSignalSchema,
} from "./envelope";
import type { SignalDecl } from "./condition";

const declared: SignalDecl[] = [
  { key: "mrr_delta_pct", type: "number" },
  { key: "is_incident", type: "boolean" },
];

describe("parseSignalSchema", () => {
  it("reads a well-formed jsonb array", () => {
    expect(
      parseSignalSchema([{ key: "a", type: "number", description: "d" }]),
    ).toEqual([{ key: "a", type: "number", description: "d" }]);
  });

  it("returns an empty list for null", () => {
    expect(parseSignalSchema(null)).toEqual([]);
  });

  it("returns an empty list for a non-array", () => {
    expect(parseSignalSchema({ key: "a" })).toEqual([]);
  });

  it("drops entries with an unknown type rather than throwing", () => {
    expect(parseSignalSchema([{ key: "a", type: "date" }])).toEqual([]);
  });

  it("drops entries with no key", () => {
    expect(parseSignalSchema([{ type: "number" }])).toEqual([]);
  });

  it("drops a non-string description rather than the whole entry", () => {
    expect(
      parseSignalSchema([{ key: "a", type: "number", description: 7 }]),
    ).toEqual([{ key: "a", type: "number", description: undefined }]);
  });

  it("treats a blank description as absent so the key name is the fallback", () => {
    expect(
      parseSignalSchema([{ key: "a", type: "number", description: "   " }]),
    ).toEqual([{ key: "a", type: "number", description: undefined }]);
  });

  it("trims a description it keeps", () => {
    expect(
      parseSignalSchema([{ key: "a", type: "number", description: " d " }]),
    ).toEqual([{ key: "a", type: "number", description: "d" }]);
  });
});

describe("normalizeEnvelope", () => {
  it("accepts a digest with declared signals", () => {
    const out = normalizeEnvelope(
      { digest: "## hi", signals: { mrr_delta_pct: -6.2 }, severity: "warn" },
      declared,
    );
    expect(out).toEqual({
      ok: true,
      envelope: {
        digest: "## hi",
        signals: { mrr_delta_pct: -6.2 },
        severity: "warn",
        noUpdates: false,
      },
    });
  });

  it("tolerates a missing signal", () => {
    const out = normalizeEnvelope({ digest: "## hi" }, declared);
    expect(out.ok).toBe(true);
    expect(out.ok && out.envelope.signals).toEqual({});
  });

  it("skips a null signal value instead of failing", () => {
    const out = normalizeEnvelope(
      { digest: "## hi", signals: { mrr_delta_pct: null } },
      declared,
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.envelope.signals).toEqual({});
  });

  it("rejects an undeclared signal key", () => {
    const out = normalizeEnvelope(
      { digest: "## hi", signals: { revenue: 1 } },
      declared,
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/revenue/);
  });

  it("rejects a wrong-typed signal", () => {
    const out = normalizeEnvelope(
      { digest: "## hi", signals: { mrr_delta_pct: "lots" } },
      declared,
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/mrr_delta_pct/);
  });

  it("rejects signals that are not an object", () => {
    const out = normalizeEnvelope({ digest: "x", signals: [1, 2] }, declared);
    expect(out.ok).toBe(false);
  });

  it("accepts no_updates with no digest", () => {
    const out = normalizeEnvelope({ no_updates: true }, declared);
    expect(out).toEqual({
      ok: true,
      envelope: { digest: "", signals: {}, severity: null, noUpdates: true },
    });
  });

  it("rejects neither a digest nor no_updates", () => {
    const out = normalizeEnvelope({}, declared);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/digest/);
  });

  it("rejects a whitespace-only digest", () => {
    const out = normalizeEnvelope({ digest: "   " }, declared);
    expect(out.ok).toBe(false);
  });

  it("rejects an unknown severity", () => {
    const out = normalizeEnvelope(
      { digest: "x", severity: "catastrophic" },
      declared,
    );
    expect(out.ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(normalizeEnvelope("a digest", declared).ok).toBe(false);
  });
});

describe("buildReportSchema", () => {
  it("produces a schema that accepts a valid report", () => {
    const schema = buildReportSchema(declared);
    expect(
      schema.safeParse({ digest: "x", signals: { is_incident: true } }).success,
    ).toBe(true);
  });

  it("produces a schema with no signals object when nothing is declared", () => {
    const schema = buildReportSchema([]);
    expect(schema.safeParse({ digest: "x" }).success).toBe(true);
  });

  it("accepts a no_updates report", () => {
    expect(
      buildReportSchema(declared).safeParse({ no_updates: true }).success,
    ).toBe(true);
  });
});
