import Link from "next/link";
import { desc, eq, and, gte, count, sql } from "drizzle-orm";
import { db } from "@/db";
import { outputs, runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SectionLabel,
  Stat,
} from "@/components/ui";
import { Plus, Sparkles, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requireOwner();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [feed, runStats, workflowStats] = await Promise.all([
    db
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
      .orderBy(desc(outputs.createdAt)),

    db
      .select({
        total: count(),
        failed:
          sql<number>`count(*) filter (where ${runs.status} = 'error')`.mapWith(
            Number,
          ),
      })
      .from(runs)
      .where(gte(runs.createdAt, startOfToday)),

    db
      .select({
        total: count(),
        enabled:
          sql<number>`count(*) filter (where ${workflows.enabled})`.mapWith(
            Number,
          ),
      })
      .from(workflows),
  ]);

  const runsToday = runStats[0]?.total ?? 0;
  const failedToday = runStats[0]?.failed ?? 0;
  const activeWorkflows = workflowStats[0]?.enabled ?? 0;
  const totalWorkflows = workflowStats[0]?.total ?? 0;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <PageShell>
      <PageHeader
        title="Overview"
        subtitle={`${greeting} — ${new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}`}
        actions={
          <ButtonLink href="/runs" variant="outline" size="sm">
            View all runs
          </ButtonLink>
        }
      />

      <div className="rise mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Digests"
          value={feed.length}
          hint="delivered"
          tone={feed.length > 0 ? "accent" : "neutral"}
        />
        <Stat
          label="Runs"
          value={runsToday}
          hint={failedToday > 0 ? `${failedToday} failed` : "no failures"}
          tone={
            failedToday > 0 ? "danger" : runsToday > 0 ? "success" : "neutral"
          }
        />
        <Stat
          label="Active"
          value={activeWorkflows}
          hint={`of ${totalWorkflows}`}
          tone={activeWorkflows > 0 ? "success" : "warn"}
        />
      </div>

      <div className="mt-10">
        <SectionLabel count={feed.length || undefined}>
          Today&apos;s digests
        </SectionLabel>
        {feed.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing has run yet today"
            description="Digests land here when a workflow finishes."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <ButtonLink href="/workflows/new" variant="primary" icon={Plus}>
                  Create a workflow
                </ButtonLink>
                <ButtonLink href="/runs" variant="ghost">
                  See past runs
                </ButtonLink>
              </div>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {feed.map((item) => (
              <Card
                key={item.outputId}
                as="article"
                interactive
                className="rise overflow-hidden"
              >
                <div className="border-border bg-bg-subtle flex items-center justify-between gap-3 border-b px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/runs/${item.runId}`}
                      className="group text-foreground flex min-w-0 items-center gap-1 text-[13px] font-medium"
                    >
                      <span className="truncate group-hover:underline">
                        {item.workflowName}
                      </span>
                      <ChevronRight className="text-subtle h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    {item.deliveredTo.length > 1 && (
                      <Badge tone="neutral">
                        {item.deliveredTo.join(" · ")}
                      </Badge>
                    )}
                  </div>
                  <time
                    dateTime={item.createdAt.toISOString()}
                    className="text-subtle shrink-0 font-mono text-[11px]"
                  >
                    {item.createdAt.toLocaleTimeString("en-US", {
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                <div className="text-foreground px-4 py-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {item.body}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
