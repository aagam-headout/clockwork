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
  SectionLabel,
  Stat,
  statusTone,
} from "@/components/ui";
import { Wrench, AlignLeft, TriangleAlert } from "lucide-react";

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

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <PageHeader
        backHref="/runs"
        backLabel="Runs"
        title={run.workflowName ?? "(deleted workflow)"}
        subtitle={
          run.startedAt
            ? run.startedAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })
            : "Not started"
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={tone} dot={run.status === "running"}>
              {run.status}
            </Badge>
            <Badge tone="neutral">{run.trigger}</Badge>
            {run.workflowId && (
              <ButtonLink href={`/workflows/${run.workflowId}`} variant="outline" size="sm">
                Edit workflow
              </ButtonLink>
            )}
          </div>
        }
      />

      <div className="rise mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Duration"
          value={run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
          tone={tone}
        />
        <Stat label="Tool calls" value={toolCalls} hint={`${steps.length} steps total`} />
        <Stat
          label="Tokens in"
          value={run.inputTokens != null ? run.inputTokens.toLocaleString() : "—"}
        />
        <Stat
          label="Tokens out"
          value={run.outputTokens != null ? run.outputTokens.toLocaleString() : "—"}
        />
      </div>

      {run.error && (
        <div className="mt-6">
          <Alert tone="danger" title="Run failed">
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {run.error}
            </pre>
          </Alert>
        </div>
      )}

      {output && (
        <section className="mt-10">
          <SectionLabel>Output</SectionLabel>
          <Card className="overflow-hidden">
            <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-foreground">
              {output.body}
            </div>
            <div className="flex items-center gap-2 border-t border-border bg-bg-subtle px-4 py-2.5 text-xs text-subtle">
              Delivered to
              {output.deliveredTo.map((target) => (
                <Badge key={target} tone="success">
                  {target}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      )}

      <section className="mt-10">
        <SectionLabel count={steps.length}>Trace</SectionLabel>

        {steps.length === 0 ? (
          <p className="rounded-container border border-border bg-bg-subtle px-4 py-8 text-center text-sm text-muted">
            No steps recorded for this run.
          </p>
        ) : (
          <ol className="relative flex flex-col gap-2.5 pl-7">
            {/* Rail behind the step markers. */}
            <span className="absolute bottom-3 left-[11px] top-3 w-px bg-border" aria-hidden />

            {steps.map((step) => {
              const isTool = step.type === "tool";
              const failed = Boolean(step.error);
              return (
                <li key={step.id} className="relative">
                  <span
                    className={`absolute -left-7 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-surface ${
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
                          <span className="truncate font-mono text-xs font-medium text-accent-text">
                            {step.toolSlug}
                          </span>
                          {step.durationMs != null && (
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle">
                              {step.durationMs}ms
                            </span>
                          )}
                        </div>
                        <details className="group mt-2">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted transition-colors hover:text-foreground">
                            <span className="transition-transform group-open:rotate-90">›</span>
                            args / result
                          </summary>
                          <pre className="mt-2 max-h-72 overflow-auto rounded-control border border-border bg-bg-subtle p-3 font-mono text-[11px] leading-relaxed text-muted">
                            {JSON.stringify(
                              { args: step.argsJson, result: step.resultJson },
                              null,
                              2
                            )}
                          </pre>
                        </details>
                        {step.error && (
                          <p className="mt-2 rounded-control border border-danger-line bg-danger-soft px-2.5 py-1.5 font-mono text-[11px] text-danger-text">
                            {step.error}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
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
    </main>
  );
}
