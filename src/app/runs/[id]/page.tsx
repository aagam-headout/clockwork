import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  ListBox,
  PageHeader,
  PageShell,
  SectionLabel,
  Stat,
  statusTone,
} from "@/components/ui";
import {
  Wrench,
  AlignLeft,
  TriangleAlert,
  Timer,
  Hammer,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  FileText,
  ListTree,
  Send,
  SquarePen,
} from "lucide-react";
import { LiveRun } from "@/components/live-run";
import { Markdown } from "@/components/markdown";
import { formatUsd } from "@/lib/model-tiers";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();

  const { id } = await params;

  const [run] = await db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      durationMs: runs.durationMs,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      costUsd: runs.costUsd,
      finishReason: runs.finishReason,
      error: runs.error,
      workflowName: workflows.name,
      workflowId: workflows.id,
    })
    .from(runs)
    .leftJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(eq(runs.id, id));

  if (!run) notFound();

  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, id))
    .orderBy(asc(runSteps.idx));

  const [output] = await db.select().from(outputs).where(eq(outputs.runId, id));

  const tone = statusTone(run.status);
  const toolCalls = steps.filter((s) => s.type === "tool").length;
  const inFlight = run.status === "running" || run.status === "queued";
  const deliveryLog = (output?.deliveryLog ?? []) as Array<{
    type: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
  }>;

  return (
    <PageShell>
      <PageHeader
        backHref="/runs"
        backLabel="Runs"
        title={run.workflowName ?? "(deleted workflow)"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot={inFlight}>
              {run.status}
            </Badge>
            <Badge tone="neutral">{run.trigger}</Badge>
            <span>
              {run.startedAt
                ? run.startedAt.toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "Not started"}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <LiveRun active={inFlight} />
            {run.workflowId && (
              <ButtonLink
                href={`/workflows/${run.workflowId}`}
                variant="outline"
                size="sm"
                icon={SquarePen}
              >
                Edit workflow
              </ButtonLink>
            )}
          </div>
        }
      />

      <div className="rise mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          icon={Timer}
          label="Duration"
          value={
            run.durationMs != null
              ? `${(run.durationMs / 1000).toFixed(1)}s`
              : "—"
          }
          hint={
            run.finishedAt
              ? `ended ${run.finishedAt.toLocaleTimeString("en-US", { timeStyle: "short" })}`
              : inFlight
                ? "in flight"
                : undefined
          }
          tone={tone}
        />
        <Stat
          icon={Hammer}
          label="Tool calls"
          value={toolCalls}
          hint={`${steps.length} steps total`}
        />
        <Stat
          icon={ArrowDownToLine}
          label="Tokens in"
          value={
            run.inputTokens != null ? run.inputTokens.toLocaleString() : "—"
          }
        />
        <Stat
          icon={ArrowUpFromLine}
          label="Tokens out"
          value={
            run.outputTokens != null ? run.outputTokens.toLocaleString() : "—"
          }
          hint={run.finishReason ? `finish: ${run.finishReason}` : undefined}
        />
        <Stat
          icon={DollarSign}
          label="Cost"
          value={formatUsd(
            run.costUsd != null ? Number(run.costUsd) : undefined,
          )}
        />
      </div>

      {run.error && (
        <div className="mt-6">
          <Alert
            tone={run.status === "truncated" ? "warn" : "danger"}
            title={run.status === "truncated" ? "Run cut short" : "Run failed"}
          >
            <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {run.error}
            </pre>
          </Alert>
        </div>
      )}

      {output && (
        <section className="mt-8">
          <SectionLabel icon={FileText}>Output</SectionLabel>
          <Card className="overflow-hidden">
            <div className="px-5 py-4.5">
              {output.unchanged ? (
                <span className="text-muted text-sm italic">
                  Nothing new since the previous digest — nothing was sent.
                </span>
              ) : (
                // The body is markdown the agent wrote for Slack/email; the
                // dashboard renders the same thing rather than showing source.
                <Markdown>{output.body}</Markdown>
              )}
            </div>
            <div className="border-border bg-bg-subtle text-subtle flex flex-wrap items-center gap-2 border-t px-5 py-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Delivery
              </span>
              {deliveryLog.length === 0 && <span>—</span>}
              {/* Three states, not two: delivered, deliberately skipped
                  because there was nothing new, and actually failed. */}
              {deliveryLog.map((entry) => (
                <span
                  key={entry.type}
                  title={entry.error}
                  className="inline-flex items-center"
                >
                  <Badge
                    tone={
                      entry.ok ? "success" : entry.skipped ? "neutral" : "warn"
                    }
                  >
                    {entry.type}
                    {entry.ok ? "" : entry.skipped ? " · skipped" : " · failed"}
                  </Badge>
                </span>
              ))}
            </div>
          </Card>
        </section>
      )}

      <section className="mt-8">
        <SectionLabel icon={ListTree} count={steps.length}>
          Trace
        </SectionLabel>

        {steps.length === 0 ? (
          <p className="rounded-container border-border bg-bg-subtle text-muted border px-4 py-8 text-center text-sm">
            No steps recorded for this run.
          </p>
        ) : (
          /*
           * One bordered box with hairline rows, not a card per step: a run of
           * twenty tool calls used to be twenty floating cards and a rail, which
           * scrolled forever and read as twenty unrelated things. Every row is
           * the same 36px summary line — index, glyph, name, duration — and the
           * body only exists while it's open. Failed steps open themselves,
           * since that's the row anyone opening a trace came for.
           */
          <ListBox as="ol">
            {steps.map((step, i) => {
              const isTool = step.type === "tool";
              const failed = Boolean(step.error);
              const text =
                (step.resultJson as { text?: string } | null)?.text ?? "";
              return (
                <li key={step.id}>
                  <details className="group" open={failed}>
                    <summary className="hover:bg-surface-hover flex h-9 cursor-pointer list-none items-center gap-2.5 px-3 transition-colors">
                      <span className="text-subtle w-4 shrink-0 text-right font-mono text-[11px] tabular-nums">
                        {i + 1}
                      </span>
                      <span
                        className={`shrink-0 ${
                          failed
                            ? "text-danger"
                            : isTool
                              ? "text-accent"
                              : "text-subtle"
                        }`}
                      >
                        {failed ? (
                          <TriangleAlert className="h-3.5 w-3.5" />
                        ) : isTool ? (
                          <Wrench className="h-3.5 w-3.5" />
                        ) : (
                          <AlignLeft className="h-3.5 w-3.5" />
                        )}
                      </span>
                      {isTool ? (
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {step.toolSlug}
                        </span>
                      ) : (
                        // Reasoning rows are titled by their own first line, so
                        // a collapsed trace still reads as a narrative.
                        <span className="text-muted truncate text-xs">
                          {text.trim().split("\n")[0] || "reasoning"}
                        </span>
                      )}
                      <span className="flex-1" />
                      {step.durationMs != null && (
                        <span className="text-subtle shrink-0 font-mono text-[11px] tabular-nums">
                          {step.durationMs}ms
                        </span>
                      )}
                      <span className="text-subtle shrink-0 text-xs transition-transform group-open:rotate-90">
                        ›
                      </span>
                    </summary>

                    {/* Indented to the glyph column so the open body reads as
                        belonging to its row rather than to the box. */}
                    <div className="border-border bg-bg-subtle space-y-2 border-t px-3 py-2.5 pl-[38px]">
                      {step.error && (
                        <p className="rounded-control border-danger-soft bg-danger-soft text-danger-text border px-2.5 py-1.5 font-mono text-[11px]">
                          {step.error}
                        </p>
                      )}
                      {isTool ? (
                        <pre className="rounded-control border-border bg-surface text-muted max-h-72 overflow-auto border p-2.5 font-mono text-[11px] leading-relaxed">
                          {JSON.stringify(
                            { args: step.argsJson, result: step.resultJson },
                            null,
                            2,
                          )}
                        </pre>
                      ) : (
                        // The model's intermediate reasoning is markdown too.
                        <Markdown>{text}</Markdown>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ListBox>
        )}
      </section>
    </PageShell>
  );
}
