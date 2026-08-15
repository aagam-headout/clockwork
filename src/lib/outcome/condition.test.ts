import { describe, expect, it } from "vitest";
import { parseCondition, evaluateCondition } from "./condition";
import type { SignalDecl } from "./condition";

const declared: SignalDecl[] = [
  { key: "mrr_delta_pct", type: "number" },
  { key: "open_prs_stale", type: "number" },
  { key: "region", type: "string" },
  { key: "is_incident", type: "boolean" },
];

function evalWith(source: string, values: Record<string, unknown>) {
  return evaluateCondition(source, declared, values as never);
}

describe("parseCondition", () => {
  it("accepts a comparison against a declared signal", () => {
    expect(parseCondition("mrr_delta_pct < -5", declared).ok).toBe(true);
  });

  it("rejects an identifier that is not a declared signal", () => {
    const out = parseCondition("revenue > 10", declared);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/unknown signal "revenue"/);
  });

  it("rejects property access", () => {
    expect(parseCondition("region.length > 2", declared).ok).toBe(false);
  });

  it("rejects a function call", () => {
    expect(parseCondition("region.toString()", declared).ok).toBe(false);
  });

  it("rejects assignment", () => {
    expect(parseCondition("open_prs_stale = 3", declared).ok).toBe(false);
  });

  it("rejects unbalanced parentheses", () => {
    expect(parseCondition("(open_prs_stale > 3", declared).ok).toBe(false);
  });

  it("rejects a SQL-flavoured injection attempt", () => {
    expect(parseCondition("1); drop table workflows; --", declared).ok).toBe(
      false,
    );
  });

  it("rejects prototype reach-through", () => {
    expect(parseCondition("__proto__ != null", declared).ok).toBe(false);
    expect(parseCondition("constructor != null", declared).ok).toBe(false);
  });

  it("rejects comparing a number signal to a string literal", () => {
    const out = parseCondition('mrr_delta_pct > "high"', declared);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/type/i);
  });

  it("rejects an ordering comparison on a boolean signal", () => {
    expect(parseCondition("is_incident > false", declared).ok).toBe(false);
  });

  it("accepts equality on a boolean signal", () => {
    expect(parseCondition("is_incident == true", declared).ok).toBe(true);
  });

  it("accepts a bare boolean signal as a condition", () => {
    expect(parseCondition("is_incident", declared).ok).toBe(true);
  });

  it("rejects a bare number signal as a condition", () => {
    const out = parseCondition("mrr_delta_pct", declared);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/boolean/i);
  });

  it("rejects an empty condition", () => {
    expect(parseCondition("   ", declared).ok).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("evaluates a numeric comparison", () => {
    expect(evalWith("mrr_delta_pct < -5", { mrr_delta_pct: -6.2 })).toBe(
      "true",
    );
    expect(evalWith("mrr_delta_pct < -5", { mrr_delta_pct: -1.2 })).toBe(
      "false",
    );
  });

  it("binds && tighter than ||", () => {
    // false && false || true  ===  (false && false) || true  ===  true
    const values = { is_incident: false, region: "eu", open_prs_stale: 9 };
    expect(
      evalWith('is_incident && region == "us" || open_prs_stale > 3', values),
    ).toBe("true");
  });

  it("honours parentheses over default precedence", () => {
    const values = { is_incident: false, region: "eu", open_prs_stale: 9 };
    expect(
      evalWith('is_incident && (region == "us" || open_prs_stale > 3)', values),
    ).toBe("false");
  });

  it("applies negation", () => {
    expect(evalWith("!is_incident", { is_incident: false })).toBe("true");
  });

  it("compares string signals for equality", () => {
    expect(evalWith('region == "eu"', { region: "eu" })).toBe("true");
    expect(evalWith('region != "eu"', { region: "eu" })).toBe("false");
  });

  it("is indeterminate when a referenced signal is missing", () => {
    expect(evalWith("mrr_delta_pct < -5", {})).toBe("indeterminate");
  });

  it("is indeterminate when a referenced signal is null", () => {
    expect(evalWith("mrr_delta_pct < -5", { mrr_delta_pct: null })).toBe(
      "indeterminate",
    );
  });

  it("short-circuits || past an indeterminate left side", () => {
    // true on the right makes the whole thing true regardless of the left
    expect(
      evalWith("mrr_delta_pct < -5 || open_prs_stale > 3", {
        open_prs_stale: 9,
      }),
    ).toBe("true");
  });

  it("short-circuits && past an indeterminate left side", () => {
    // false on the right makes the whole thing false regardless of the left
    expect(
      evalWith("mrr_delta_pct < -5 && open_prs_stale > 3", {
        open_prs_stale: 1,
      }),
    ).toBe("false");
  });

  it("propagates indeterminate when it cannot be short-circuited", () => {
    expect(
      evalWith("mrr_delta_pct < -5 && open_prs_stale > 3", {
        open_prs_stale: 9,
      }),
    ).toBe("indeterminate");
  });

  it("propagates indeterminate through negation", () => {
    expect(evalWith("!is_incident", {})).toBe("indeterminate");
  });

  it("is indeterminate when a value contradicts its declared type", () => {
    // The parser cannot catch this: the declaration says number, the agent
    // reported a string. Not comparable, and not false either.
    expect(evalWith("mrr_delta_pct < -5", { mrr_delta_pct: "lots" })).toBe(
      "indeterminate",
    );
  });

  it("returns an error for a source that does not parse", () => {
    const out = evalWith("revenue > 1", {});
    expect(out).toEqual({ error: expect.stringMatching(/unknown signal/) });
  });
});
