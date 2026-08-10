import Link from "next/link";
import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "@/db";
import { outputs, runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";

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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-medium tracking-tight text-foreground">Today</h1>
      <p className="mt-1 text-sm text-muted">
        {feed.length === 0 ? "Nothing has run yet today." : `${feed.length} digest${feed.length === 1 ? "" : "s"} so far`}
      </p>

      {feed.length === 0 && (
        <p className="mt-10 text-sm text-muted">
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
      )}

      <div className="mt-8 flex flex-col gap-6">
        {feed.map((item) => (
          <article key={item.outputId} className="rounded-lg border border-border px-5 py-4">
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
