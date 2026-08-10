import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-xl font-medium tracking-tight text-foreground">
        {run.workflowName ?? "(deleted workflow)"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {run.trigger} · {run.status}
        {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
        {run.inputTokens != null &&
          run.outputTokens != null &&
          ` · ${run.inputTokens} in / ${run.outputTokens} out tokens`}
      </p>

      {run.error && (
        <pre className="mt-6 whitespace-pre-wrap rounded-md border border-red-900/40 bg-red-950/30 px-4 py-3 text-xs text-red-400">
          {run.error}
        </pre>
      )}

      {output && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-foreground">Output</h2>
          <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
            {output.body}
          </div>
          <p className="mt-1 text-xs text-muted">Delivered to: {output.deliveredTo.join(", ")}</p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-foreground">Steps ({steps.length})</h2>
        <ol className="mt-2 flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.id} className="rounded-lg border border-border px-4 py-3">
              {step.type === "tool" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium text-accent">
                      {step.toolSlug}
                    </span>
                    {step.durationMs != null && (
                      <span className="text-xs text-muted">{step.durationMs}ms</span>
                    )}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted">args / result</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                      {JSON.stringify({ args: step.argsJson, result: step.resultJson }, null, 2)}
                    </pre>
                  </details>
                  {step.error && (
                    <p className="mt-2 text-xs text-danger">{step.error}</p>
                  )}
                </>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {(step.resultJson as { text?: string } | null)?.text}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
