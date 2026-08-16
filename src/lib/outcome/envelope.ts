import { z } from "zod";
import type { SignalDecl, SignalType, SignalValues } from "./condition";

/*
 * The validated result of a run.
 *
 * `signals` is the machine-readable half — what conditions evaluate against
 * and what a chained child receives. `digest` remains the human artefact.
 * Keeping them in one object means a run has exactly one outcome, rather
 * than a digest and a separately-derived set of numbers that could disagree.
 */
export type Envelope = {
  digest: string;
  signals: SignalValues;
  severity: "info" | "warn" | "critical" | null;
  noUpdates: boolean;
};

const SEVERITIES = ["info", "warn", "critical"] as const;
const TYPES: SignalType[] = ["number", "string", "boolean"];

/**
 * Reads `workflows.signalSchema`, which is jsonb and therefore `unknown`.
 *
 * Tolerant on purpose: a malformed entry is dropped rather than thrown, so a
 * hand-edited row can't take a workflow permanently out of service. The form
 * validates on the way in; this is the last line on the way out.
 */
export function parseSignalSchema(raw: unknown): SignalDecl[] {
  if (!Array.isArray(raw)) return [];

  const out: SignalDecl[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = record.key;
    const type = record.type;
    if (typeof key !== "string" || !key) continue;
    if (typeof type !== "string" || !TYPES.includes(type as SignalType)) {
      continue;
    }
    out.push({
      key,
      type: type as SignalType,
      description:
        typeof record.description === "string" ? record.description : undefined,
    });
  }
  return out;
}

function zodForType(type: SignalType) {
  if (type === "number") return z.number();
  if (type === "boolean") return z.boolean();
  return z.string();
}

/**
 * The `report` tool's input schema, built per workflow.
 *
 * Declared signals become named optional fields rather than a free-form
 * record, so the model sees the exact key names and types it's expected to
 * fill — the schema is the instruction, cheaper than saying the same thing
 * in prose in the system prompt.
 */
export function buildReportSchema(declared: SignalDecl[]) {
  const base = {
    digest: z
      .string()
      .optional()
      .describe(
        "The markdown digest a human will read. Omit only when no_updates is true.",
      ),
    severity: z
      .enum(SEVERITIES)
      .optional()
      .describe("How urgent this digest is."),
    no_updates: z
      .boolean()
      .optional()
      .describe(
        "True when nothing has changed since the previous digest. Send no digest.",
      ),
  };

  if (declared.length === 0) return z.object(base);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const decl of declared) {
    shape[decl.key] = zodForType(decl.type)
      .optional()
      .describe(decl.description ?? `Signal ${decl.key}`);
  }

  return z.object({
    ...base,
    signals: z
      .object(shape)
      .optional()
      .describe(
        "The measured values this run found. Fill every signal you can; conditions are evaluated against these.",
      ),
  });
}

export function normalizeEnvelope(
  input: unknown,
  declared: SignalDecl[],
): { ok: true; envelope: Envelope } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "report expects an object" };
  }
  const record = input as Record<string, unknown>;

  const noUpdates = record.no_updates === true;
  const digestRaw = record.digest;
  const digest = typeof digestRaw === "string" ? digestRaw.trim() : "";

  if (!noUpdates && !digest) {
    return {
      ok: false,
      error: "report needs either a digest or no_updates: true",
    };
  }

  const severityRaw = record.severity;
  let severity: Envelope["severity"] = null;
  if (severityRaw !== undefined && severityRaw !== null) {
    if (
      typeof severityRaw !== "string" ||
      !SEVERITIES.includes(severityRaw as (typeof SEVERITIES)[number])
    ) {
      return {
        ok: false,
        error: `severity must be one of ${SEVERITIES.join(", ")}`,
      };
    }
    severity = severityRaw as Envelope["severity"];
  }

  const signals: SignalValues = {};
  const signalsRaw = record.signals;
  if (signalsRaw !== undefined && signalsRaw !== null) {
    if (typeof signalsRaw !== "object" || Array.isArray(signalsRaw)) {
      return { ok: false, error: "signals must be an object" };
    }
    const byKey = new Map(declared.map((d) => [d.key, d]));
    for (const [key, value] of Object.entries(
      signalsRaw as Record<string, unknown>,
    )) {
      // A signal the run couldn't measure is absent, not zero — dropping it
      // here is what makes the condition indeterminate, not false.
      if (value === null || value === undefined) continue;

      const decl = byKey.get(key);
      if (!decl) {
        return {
          ok: false,
          error: `unknown signal "${key}" — this workflow declares ${
            declared.map((d) => d.key).join(", ") || "no signals"
          }`,
        };
      }
      if (typeof value !== decl.type) {
        return {
          ok: false,
          error: `signal "${key}" must be a ${decl.type}, got ${typeof value}`,
        };
      }
      signals[key] = value as number | string | boolean;
    }
  }

  return {
    ok: true,
    envelope: { digest: noUpdates ? "" : digest, signals, severity, noUpdates },
  };
}
