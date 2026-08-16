"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SignalDecl, SignalType } from "@/lib/outcome/condition";
import { LIMITS } from "@/lib/limits";

/*
 * Signals and the alert condition that reads them.
 *
 * Its own file rather than more of `workflow-form.tsx`, which is already long
 * enough that finding anything in it is a scroll. The two belong together: a
 * condition is written against the signal names declared right above it, and
 * the helper text under the condition field is the only place those names are
 * listed for the person typing it.
 *
 * The rows travel as one JSON hidden field. Individual `name="signal.0.key"`
 * inputs would need the server to reassemble an array out of a flat FormData
 * and to guess at gaps left by a deleted row; one field is parsed once, by
 * `parseSignalSchema`, which is the same reader the run path uses.
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
          <div className="flex flex-col gap-2">
            {signals.map((signal, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  value={signal.key}
                  onChange={(e) =>
                    update(i, { key: e.target.value.toLowerCase() })
                  }
                  placeholder="open_prs_stale"
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
