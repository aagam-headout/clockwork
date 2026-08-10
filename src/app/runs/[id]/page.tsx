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
  PageHeader,
  PageShell,
  SectionLabel,
  Stat,
  statusTone,
} from "@/components/ui";
import { Wrench, AlignLeft, TriangleAlert } from "lucide-react";
import { LiveRun } from "@/components/live-run";
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
    error?: string;
  }>;

  return (
    <PageShell>
      <PageHeader
        backHref="/runs"
        backLabel="Runs"
        title={run.workflowName ?? "(deleted workflow)"}
        subtitle={
          run.startedAt
            ? run.startedAt.toLocaleString("en-US", {
                dateStyle: "full",
                timeStyle: "short",
              })
            : "Not started"
        }
        actions={
          <div className="flex items-center gap-2">
            <LiveRun active={inFlight} />
            <Badge tone={tone} dot={inFlight}>
              {run.status}
            </Badge>
            <Badge tone="neutral">{run.trigger}</Badge>
            {run.workflowId && (
              <ButtonLink
                href={`/workflows/${run.workflowId}`}
                variant="outline"
                size="sm"
              >
                Edit workflow
              </ButtonLink>
            )}
          </div>
        }
      />

      <div className="rise mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Duration"
          value={
            run.durationMs != null
              ? `${(run.durationMs / 1000).toFixed(1)}s`
              : "—"
          }
          tone={tone}
        />
        <Stat
          label="Tool calls"
          value={toolCalls}
          hint={`${steps.length} steps total`}
        />
        <Stat
          label="Tokens in"
          value={
            run.inputTokens != null ? run.inputTokens.toLocaleString() : "—"
          }
        />
        <Stat
          label="Tokens out"
          value={
            run.outputTokens != null ? run.outputTokens.toLocaleString() : "—"
          }
          hint={run.finishReason ? `finish: ${run.finishReason}` : undefined}
        />
        <Stat
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
        <section className="mt-10">
          <SectionLabel>Output</SectionLabel>
          <Card className="overflow-hidden">
            <div className="text-foreground px-4 py-4 text-sm leading-relaxed whitespace-pre-wrap">
              {output.unchanged ? (
                <span className="text-muted italic">
                  Nothing new since the previous digest — nothing was sent.
                </span>
              ) : (
                output.body
              )}
            </div>
            <div className="border-border bg-bg-subtle text-subtle flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs">
              Delivery
              {deliveryLog.length === 0 && <span>—</span>}
              {deliveryLog.map((entry) => (
                <span
                  key={entry.type}
                  title={entry.error}
                  className="inline-flex items-center"
                >
                  <Badge tone={entry.ok ? "success" : "warn"}>
                    {entry.type}
                    {entry.ok ? "" : " · failed"}
                  </Badge>
                </span>
              ))}
            </div>
          </Card>
        </section>
      )}

      <section className="mt-10">
        <SectionLabel count={steps.length}>Trace</SectionLabel>

        {steps.length === 0 ? (
          <p className="rounded-container border-border bg-bg-subtle text-muted border px-4 py-8 text-center text-sm">
            No steps recorded for this run.
          </p>
        ) : (
          <ol className="relative flex flex-col gap-2.5 pl-7">
            {/* Rail behind the step markers. */}
            <span
              className="bg-border absolute top-3 bottom-3 left-[11px] w-px"
              aria-hidden
            />

            {steps.map((step) => {
              const isTool = step.type === "tool";
              const failed = Boolean(step.error);
              return (
                <li key={step.id} className="relative">
                  <span
                    className={`bg-surface absolute top-3 -left-7 flex h-[22px] w-[22px] items-center justify-center rounded-full border ${
                      failed
                        ? "border-danger/40 text-danger"
                        : isTool
                          ? "border-border text-accent"
                          : "border-border text-muted"
                    }`}
                  >
                    {failed ? (
                      <TriangleAlert className="h-3 w-3" />
                    ) : isTool ? (
                      <Wrench className="h-3.5 w-3.5" />
                    ) : (
                      <AlignLeft className="h-3.5 w-3.5" />
                    )}
                  </span>

                  <Card className="p-3.5">
                    {isTool ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-accent-text truncate font-mono text-xs font-medium">
                            {step.toolSlug}
                          </span>
                          {step.durationMs != null && (
                            <span className="text-subtle shrink-0 font-mono text-[11px] tabular-nums">
                              {step.durationMs}ms
                            </span>
                          )}
                        </div>
                        <details className="group mt-2">
                          <summary className="text-muted hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs transition-colors">
                            <span className="transition-transform group-open:rotate-90">
                              ›
                            </span>
                            args / result
                          </summary>
                          <pre className="rounded-control border-border bg-bg-subtle text-muted mt-2 max-h-72 overflow-auto border p-3 font-mono text-[11px] leading-relaxed">
                            {JSON.stringify(
                              { args: step.argsJson, result: step.resultJson },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        {step.error && (
                          <p className="rounded-control border-danger-line bg-danger-soft text-danger-text mt-2 border px-2.5 py-1.5 font-mono text-[11px]">
                            {step.error}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                        {(step.resultJson as { text?: string } | null)?.text}
                      </p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </PageShell>
  );
}
