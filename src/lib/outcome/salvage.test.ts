import { describe, expect, it } from "vitest";
import { salvageEnvelope } from "./salvage";
import type { SignalDecl } from "./condition";

const NONE: SignalDecl[] = [];
const SIGNALS: SignalDecl[] = [{ key: "n", type: "number" }];

describe("salvageEnvelope", () => {
  it("reads a report the model typed instead of calling", () => {
    const text =
      'I now have confirmation of 18 emails.\n\n<report> { "digest": "## 18 emails", "severity": "info" } </report>';

    expect(salvageEnvelope(text, NONE)).toEqual({
      digest: "## 18 emails",
      signals: {},
      severity: "info",
      noUpdates: false,
    });
  });

  it("keeps the signals, so thresholds still have values", () => {
    const text = '<report>{"digest": "## D", "signals": {"n": 9}}</report>';

    expect(salvageEnvelope(text, SIGNALS)?.signals).toEqual({ n: 9 });
  });

  it("reads no_updates", () => {
    const text = '<report>{"no_updates": true}</report>';

    expect(salvageEnvelope(text, NONE)).toMatchObject({
      noUpdates: true,
      digest: "",
    });
  });

  it("unwraps a fenced block inside the tag", () => {
    const text = '<report>\n```json\n{"digest": "## D"}\n```\n</report>';

    expect(salvageEnvelope(text, NONE)?.digest).toBe("## D");
  });

  it("takes the last block when the model corrected itself", () => {
    const text =
      '<report>{"digest": "first"}</report> wait —\n<report>{"digest": "second"}</report>';

    expect(salvageEnvelope(text, NONE)?.digest).toBe("second");
  });

  it("reads bare call arguments that are the whole message", () => {
    const text = '{"digest": "## D"}';

    expect(salvageEnvelope(text, NONE)?.digest).toBe("## D");
  });

  it("reads bare call arguments inside a fence", () => {
    const text = '```json\n{"digest": "## D"}\n```';

    expect(salvageEnvelope(text, NONE)?.digest).toBe("## D");
  });

  it("does not dig untagged JSON out of surrounding prose", () => {
    // A digest that quotes a payload is not a mis-typed call, and this path
    // delivers — reading "x" out of it would send the wrong text to Slack.
    const text = '## Digest\n\nThe payload was {"digest": "x"} — unchanged.';

    expect(salvageEnvelope(text, NONE)).toBeNull();
  });

  it("returns null for prose that merely mentions a report", () => {
    expect(salvageEnvelope("I will report the 18 emails.", NONE)).toBeNull();
  });

  it("returns null for a malformed block rather than guessing", () => {
    expect(salvageEnvelope("<report>{ not json }</report>", NONE)).toBeNull();
  });

  it("returns null when the payload fails validation", () => {
    // No digest and no no_updates — the tool would have rejected it too.
    expect(salvageEnvelope('<report>{"severity": "info"}</report>', NONE)).toBe(
      null,
    );
  });

  it("drops an unknown signal and keeps the digest, matching the tool", () => {
    // The tool's schema is a zod object, which strips keys it doesn't declare
    // — so a hallucinated signal never reaches validation and never fails the
    // call. Salvage has to be exactly as forgiving, no more.
    const text =
      '<report>{"digest": "## D", "signals": {"n": 9, "other": 1}}</report>';

    expect(salvageEnvelope(text, SIGNALS)).toEqual({
      digest: "## D",
      signals: { n: 9 },
      severity: null,
      noUpdates: false,
    });
  });

  it("keeps a digest from a workflow that declares no signals at all", () => {
    // No declaration means no `signals` field on the schema, so the whole
    // object is stripped rather than rejected.
    const text = '<report>{"digest": "## D", "signals": {"other": 1}}</report>';

    expect(salvageEnvelope(text, NONE)?.digest).toBe("## D");
  });

  it("returns null when a signal has the wrong type, matching the tool", () => {
    const text =
      '<report>{"digest": "## D", "signals": {"n": "nine"}}</report>';

    expect(salvageEnvelope(text, SIGNALS)).toBeNull();
  });
});
