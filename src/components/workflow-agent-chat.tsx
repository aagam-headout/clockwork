"use client";

import { useState } from "react";
import type { WorkflowFormValues } from "@/components/workflow-form";

type Proposal = WorkflowFormValues & { rationale: string };

export function WorkflowAgentChat({ onPropose }: { onPropose: (values: Proposal) => void }) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
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
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <p className="text-xs font-medium text-foreground">Describe it, I&apos;ll fill the form</p>
      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Every weekday morning, check my calendar and DM me a heads up on Slack"
          className="input"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !description.trim()}
          className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Generate"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {rationale && !error && <p className="mt-2 text-xs text-muted">{rationale}</p>}
    </div>
  );
}
