"use client";

import { useState } from "react";
import type { WorkflowFormValues } from "@/components/workflow-form";
import { Send, Sparkles, Check } from "lucide-react";
import { buttonClass } from "@/components/ui";

type Proposal = WorkflowFormValues & { rationale: string };

const EXAMPLES = [
  "Every weekday 8am, check my calendar and DM me a heads up on Slack",
  "Friday 5pm, summarize the GitHub issues assigned to me this week",
  "Every morning, flag unread Gmail threads that look urgent",
];

export function WorkflowAgentChat({ onPropose }: { onPropose: (values: Proposal) => void }) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);

  async function submit(text: string) {
    if (!text.trim() || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate workflow");

      onPropose(data);
      setRationale(data.rationale);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-container border border-border bg-bg-subtle p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-control border border-border bg-surface text-foreground">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="heading-14 text-foreground">Describe it, I&apos;ll fill the form</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(description);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Every weekday morning, check my calendar and DM me a heads up on Slack"
          className="input h-10"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !description.trim()}
          className={buttonClass("primary", "md")}
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              Thinking…
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" />
              Generate
            </>
          )}
        </button>
      </form>

      {!rationale && !error && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={loading}
              onClick={() => {
                setDescription(example);
                void submit(example);
              }}
              className="h-7 max-w-full cursor-pointer truncate rounded-full border border-border bg-surface px-3 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-2.5 rounded-control border border-danger-line bg-danger-soft px-2.5 py-1.5 text-[13px] text-danger-text">
          {error}
        </p>
      )}

      {rationale && !error && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>{rationale}</span>
        </p>
      )}
    </div>
  );
}
