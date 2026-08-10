import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  Badge,
  EmptyState,
  ListBox,
  PageHeader,
  PageShell,
  SectionLabel,
  StatusDot,
  statusTone,
} from "@/components/ui";
import { History, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

function relative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function RunsPage() {
  await requireOwner();

  const rows = await db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      startedAt: runs.startedAt,
      createdAt: runs.createdAt,
      durationMs: runs.durationMs,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      workflowName: workflows.name,
    })
    .from(runs)
    .leftJoin(workflows, eq(runs.workflowId, workflows.id))
    .orderBy(desc(runs.createdAt))
    .limit(100);

  // Group into day buckets so a long history stays scannable.
  const groups: Array<{ label: string; items: typeof rows }> = [];
  for (const run of rows) {
    const label = dayLabel(run.startedAt ?? run.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(run);
    else groups.push({ label, items: [run] });
  }

  const failed = rows.filter((r) => r.status === "error").length;

  return (
    <PageShell>
      <PageHeader
        title="Runs"
        subtitle="Every execution of your workflows, newest first."
        actions={
          rows.length === 0 ? undefined : (
            <Badge tone={failed > 0 ? "danger" : "success"} dot>
              {rows.length} runs{failed > 0 ? ` · ${failed} failed` : ""}
            </Badge>
          )
        }
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={History}
            title="No runs recorded"
            description="Runs appear here with their full tool trace."
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.label} className="rise">
              <SectionLabel count={group.items.length}>
                {group.label}
              </SectionLabel>

              <ListBox>
                {group.items.map((run) => {
                  const tone = statusTone(run.status);
                  const at = run.startedAt ?? run.createdAt;
                  return (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}`}
                      className="group hover:bg-surface-hover flex items-center gap-3 px-4 py-3 transition-colors"
                    >
                      <StatusDot tone={tone} live={run.status === "running"} />

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {run.workflowName ?? "(deleted workflow)"}
                          </span>
                          <Badge tone="neutral">{run.trigger}</Badge>
                        </div>
                        <p className="text-subtle mt-0.5 truncate font-mono text-[11px]">
                          {at.toLocaleTimeString("en-US", {
                            timeStyle: "short",
                          })}
                          {run.durationMs != null &&
                            ` · ${(run.durationMs / 1000).toFixed(1)}s`}
                          {run.inputTokens != null &&
                            run.outputTokens != null &&
                            ` · ${(run.inputTokens + run.outputTokens).toLocaleString()} tok`}
                        </p>
                      </div>

                      <span className="text-subtle hidden shrink-0 text-[11px] sm:block">
                        {relative(at)}
                      </span>
                      <Badge tone={tone} dot={run.status === "running"}>
                        {run.status}
                      </Badge>
                      <ChevronRight className="text-subtle h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  );
                })}
              </ListBox>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
