import Link from "next/link";
import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "@/db";
import { outputs, runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import { cardClass } from "@/lib/card-class";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requireOwner();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const feed = await db
    .select({
      outputId: outputs.id,
      body: outputs.body,
      createdAt: outputs.createdAt,
      deliveredTo: outputs.deliveredTo,
      workflowName: workflows.name,
      runId: runs.id,
      runStatus: runs.status,
    })
    .from(outputs)
    .innerJoin(runs, eq(outputs.runId, runs.id))
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(and(eq(runs.status, "ok"), gte(outputs.createdAt, startOfToday)))
    .orderBy(desc(outputs.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-8 py-12">
      <h1 className="text-xl font-medium tracking-tight text-foreground">Today</h1>
      <p className="mt-1 text-sm text-muted">
        {feed.length === 0
          ? "Nothing has run yet today."
          : `${feed.length} digest${feed.length === 1 ? "" : "s"} so far`}
      </p>

      {feed.length === 0 && (
        <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-muted">
            Set up a workflow at{" "}
            <Link href="/workflows/new" className="text-accent underline">
              /workflows/new
            </Link>{" "}
            or check{" "}
            <Link href="/runs" className="text-accent underline">
              past runs
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {feed.map((item) => (
          <article key={item.outputId} className={cardClass()}>
            <div className="flex items-center justify-between">
              <Link
                href={`/runs/${item.runId}`}
                className="text-sm font-medium text-foreground hover:underline"
              >
                {item.workflowName}
              </Link>
              <span className="text-xs text-muted">
                {item.createdAt.toLocaleTimeString("en-US", { timeStyle: "short" })}
              </span>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm text-foreground">{item.body}</div>
          </article>
        ))}
      </div>
    </main>
  );
}
