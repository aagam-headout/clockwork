"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkflowFormValues } from "@/components/workflow-form";
import {
  ArrowUp,
  Sparkles,
  RotateCcw,
  TriangleAlert,
  Clock,
  Cpu,
  Wrench,
} from "lucide-react";
import { buttonClass } from "@/components/ui";

type Proposal = WorkflowFormValues & { rationale: string };

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; spec?: Proposal };

const EXAMPLES = [
  "Every weekday 8am, check my calendar and DM me a heads up on Slack",
  "Friday 5pm, summarize the GitHub issues assigned to me this week",
  "Every morning, flag unread Gmail threads that look urgent",
];

/**
 * The left pane of the new-workflow screen: a conversation that writes the form
 * on the right. It keeps the whole turn history plus the spec it last proposed
 * and sends both to /api/workflows/propose, so a follow-up like "make it
 * hourly" edits that spec instead of starting from nothing.
 */
export function WorkflowAgentChat({
  onPropose,
}: {
  onPropose: (values: Proposal) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin to the newest turn — including the pending bubble, so the user sees
  // that their message landed.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/workflows/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate workflow");

      onPropose(data);
      setCurrent(data);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.rationale, spec: data },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    setCurrent(null);
    setError(null);
    setDraft("");
  }

  const empty = messages.length === 0;

  return (
    <div className="rounded-container border-border bg-surface flex h-full min-h-0 flex-col overflow-hidden border">
      <div className="border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex items-center gap-2">
          <span className="rounded-control border-border bg-bg-subtle text-foreground flex h-6 w-6 items-center justify-center border">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="heading-14 text-foreground">Assistant</span>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={reset}
            className={buttonClass("ghost", "sm", "gap-1 px-2")}
            title="Start over"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {/* The pane is wide; the column inside it stays a readable width. Turns
            hug the composer the way every chat does — the empty pitch centers. */}
        <div
          className={`mx-auto flex min-h-full w-full max-w-[680px] flex-col ${
            empty ? "justify-center" : "justify-end"
          }`}
        >
          {empty ? (
            <div className="flex flex-col">
              <p className="text-muted text-sm leading-relaxed">
                Describe the job in plain English. I&apos;ll fill in the
                schedule, tools, model and prompt on the right — then you can
                edit anything before saving.
              </p>
              <div className="mt-4 flex flex-col gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="rounded-control border-border bg-bg-subtle text-muted hover:border-border-strong hover:text-foreground cursor-pointer border px-3 py-2 text-left text-[13px] leading-snug transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message, i) =>
                message.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="rounded-container bg-solid text-solid-fg max-w-[85%] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex flex-col gap-2">
                    <p className="rounded-container border-border bg-bg-subtle text-foreground max-w-[92%] border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                    {message.spec && <SpecSummary spec={message.spec} />}
                  </div>
                ),
              )}

              {loading && (
                <div className="text-muted flex items-center gap-2 text-[13px]">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                  Working on it…
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-control border-danger-line bg-danger-soft text-danger-text mt-3 flex items-start gap-1.5 border px-2.5 py-2 text-[13px]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="border-border shrink-0 border-t px-4 py-3"
      >
        <div className="rounded-container border-border bg-bg focus-within:border-border-strong mx-auto flex w-full max-w-[680px] items-end gap-2 border p-1.5 transition-colors">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every
              // chat composer uses.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={3}
            placeholder={
              empty
                ? "Every weekday morning, check my calendar…"
                : "Refine it — “make it hourly”"
            }
            disabled={loading}
            aria-label="Describe the workflow"
            className="text-foreground placeholder:text-subtle max-h-40 min-h-0 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-relaxed outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            aria-label="Send"
            className={buttonClass("primary", "sm", "w-8 shrink-0 px-0")}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

/** What the assistant just wrote into the form, at a glance. */
function SpecSummary({ spec }: { spec: Proposal }) {
  const items: Array<{
    icon: React.ComponentType<{ className?: string }>;
    text: string;
  }> = [
    { icon: Clock, text: `${spec.cron} · ${spec.timezone}` },
    { icon: Wrench, text: spec.toolkits.join(", ") },
    { icon: Cpu, text: spec.model },
  ];

  return (
    <div className="rounded-container border-border flex flex-col gap-1 border px-3 py-2">
      <span className="text-foreground text-[13px] font-medium">
        {spec.name}
      </span>
      {items.map(({ icon: Icon, text }) => (
        <span
          key={text}
          className="text-muted flex items-center gap-1.5 text-xs"
        >
          <Icon className="text-subtle h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{text}</span>
        </span>
      ))}
    </div>
  );
}
