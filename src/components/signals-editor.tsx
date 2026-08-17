"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SignalDecl, SignalType } from "@/lib/outcome/condition";
import { LIMITS } from "@/lib/limits";

/*
 * Signals and the alert condition that reads them.
 *
 * Its own file, not more of the already-long `workflow-form.tsx`. The two
 * belong together: a condition is written against the signal names declared
 * above it, and the helper text under the condition field is the only place
 * those names are listed for the person typing it.
 *
 * A row's description is the field's only prose instruction to the agent: it
 * becomes the zod `.describe()` on that key in the `report` tool schema, and
 * without one the model sees nothing but the key name. Optional, but the
 * difference between `errors` meaning anything and meaning one thing.
 *
 * The rows travel as one JSON hidden field. Individual `name="signal.0.key"`
 * inputs would need the server to reassemble an array from flat FormData and
 * guess at gaps from deleted rows; one field is parsed once, by
 * `parseSignalSchema`, the same reader the run path uses.
 */

const TYPES: SignalType[] = ["number", "string", "boolean"];

export function SignalsEditor({
  defaultSignals = [],
  defaultCondition = "",
}: {
  defaultSignals?: SignalDecl[];
  defaultCondition?: string;
}) {
  const [signals, setSignals] = useState<SignalDecl[]>(defaultSignals);
  const [condition, setCondition] = useState(defaultCondition);

  const atLimit = signals.length >= LIMITS.maxSignalsPerWorkflow;

  function update(index: number, patch: Partial<SignalDecl>) {
    setSignals((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <>
      <input
        type="hidden"
        name="signalSchema"
        value={JSON.stringify(signals)}
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-foreground text-[13px] font-medium">
            Signals
          </label>
          <span className="text-subtle text-xs tabular-nums">
            {signals.length}/{LIMITS.maxSignalsPerWorkflow}
          </span>
        </div>

        {signals.length === 0 ? (
          <p className="text-subtle text-xs leading-relaxed">
            Optional. Add one for a value you want to compare against a
            threshold — a count, a percentage, an age in days.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {signals.map((signal, i) => (
              // Remove sits outside the field column rather than in the top
              // row: both fields belong to one signal, so tabbing goes name,
              // type, description, and only then reaches the destructive
              // control — and the description ends where the row does without
              // hardcoding the button's width as a margin.
              <div key={i} className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <input
                      value={signal.key}
                      onChange={(e) =>
                        update(i, { key: e.target.value.toLowerCase() })
                      }
                      placeholder="open_prs_stale"
                      maxLength={LIMITS.maxSignalKeyChars}
                      aria-label={`Signal ${i + 1} name`}
                      className="input min-w-0 flex-1 font-mono text-[13px]"
                    />
                    <select
                      value={signal.type}
                      onChange={(e) =>
                        update(i, { type: e.target.value as SignalType })
                      }
                      aria-label={`Signal ${i + 1} type`}
                      className="input w-[104px] shrink-0 text-[13px]"
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={signal.description ?? ""}
                    onChange={(e) =>
                      update(i, { description: e.target.value || undefined })
                    }
                    placeholder="What to measure — count only P1, exclude auto-resolved"
                    maxLength={LIMITS.maxSignalDescriptionChars}
                    aria-label={`Signal ${i + 1} description`}
                    className="input min-w-0 text-[13px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSignals((rows) => rows.filter((_, j) => j !== i))
                  }
                  aria-label={`Remove signal ${signal.key || i + 1}`}
                  className="rounded-control border-border text-muted hover:border-border-strong hover:text-foreground flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            disabled={atLimit}
            onClick={() =>
              setSignals((rows) => [...rows, { key: "", type: "number" }])
            }
            className="rounded-control border-border text-muted hover:border-border-strong hover:text-foreground mt-1 inline-flex h-8 cursor-pointer items-center gap-1.5 border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-3.5 w-3.5" />
            Add signal
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-foreground text-[13px] font-medium">
          Only alert when
        </label>
        <input
          name="alertCondition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          disabled={signals.length === 0}
          placeholder={
            signals.length === 0
              ? "Add a signal first"
              : "open_prs_stale > 3 || mrr_delta_pct < -5"
          }
          className="input font-mono text-[13px] disabled:cursor-not-allowed disabled:opacity-55"
        />
        <p className="text-subtle text-xs leading-relaxed">
          {signals.length === 0 ? (
            "Empty delivers every digest."
          ) : (
            <>
              Comparisons, <code className="font-mono">{"&&"}</code>,{" "}
              <code className="font-mono">||</code>,{" "}
              <code className="font-mono">!</code> only. Empty delivers every
              digest. Available:{" "}
              <span className="font-mono">
                {signals
                  .map((s) => s.key)
                  .filter(Boolean)
                  .join(", ") || "name your signals above"}
              </span>
            </>
          )}
        </p>
      </div>
    </>
  );
}
