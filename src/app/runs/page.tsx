import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  Alert,
  Badge,
  EmptyState,
  ListBox,
  PageHeader,
  PageShell,
  SectionLabel,
  StatusDot,
  statusTone,
} from "@/components/ui";
import { History, ChevronRight, Clock, Calendar } from "lucide-react";
import { LiveRun } from "@/components/live-run";
import { formatUsd } from "@/lib/model-tiers";

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

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  await requireOwner();

  // Set when "Run now" landed on a workflow that was already running — the
  // list is the right place to be, but not without being told why.
  const { notice } = await searchParams;

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
      costUsd: runs.costUsd,
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
  const inFlight = rows.some(
    (r) => r.status === "running" || r.status === "queued",
  );
  const spend = rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);

  return (
    <PageShell>
      <PageHeader
        title="Runs"
        subtitle="Every execution of your workflows, newest first."
        actions={
          rows.length === 0 ? undefined : (
            <div className="flex items-center gap-2">
              <LiveRun active={inFlight} />
              <Badge tone={failed > 0 ? "danger" : "success"} dot>
                {rows.length} runs{failed > 0 ? ` · ${failed} failed` : ""}
              </Badge>
              {spend > 0 && <Badge tone="neutral">{formatUsd(spend)}</Badge>}
            </div>
          )
        }
      />

      {notice && (
        <div className="mt-6">
          <Alert tone="accent" title="Already running">
            {notice}
          </Alert>
        </div>
      )}

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
              <SectionLabel icon={Calendar} count={group.items.length}>
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
                      {/* The dot sits on the title's cap-height rather than the
                          two-line block's midpoint. */}
                      <span className="flex h-5 shrink-0 items-center">
                        <StatusDot
                          tone={tone}
                          live={run.status === "running"}
                        />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {run.workflowName ?? "(deleted workflow)"}
                          </span>
                          <Badge tone="neutral">{run.trigger}</Badge>
                        </div>
                        {/* Metadata as separate spans on a fixed gap, not a
                            "·"-joined string: the separators used to survive
                            when the value between them was missing. */}
                        <div className="text-subtle mt-1 flex min-w-0 items-center gap-2.5 font-mono text-[11px] tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {at.toLocaleTimeString("en-US", {
                              timeStyle: "short",
                            })}
                          </span>
                          {run.durationMs != null && (
                            <span>{(run.durationMs / 1000).toFixed(1)}s</span>
                          )}
                          {run.inputTokens != null &&
                            run.outputTokens != null && (
                              <span className="hidden sm:inline">
                                {(
                                  run.inputTokens + run.outputTokens
                                ).toLocaleString()}{" "}
                                tok
                              </span>
                            )}
                        </div>
                      </div>

                      {/* Fixed-width right columns so cost and time line up
                          down the list instead of ragging off the name. */}
                      <span className="text-subtle hidden w-16 shrink-0 text-right font-mono text-[11px] tabular-nums sm:block">
                        {run.costUsd != null
                          ? formatUsd(Number(run.costUsd))
                          : ""}
                      </span>
                      <span className="text-subtle hidden w-20 shrink-0 text-right text-[11px] sm:block">
                        {relative(at)}
                      </span>
                      <span className="flex w-[86px] shrink-0 justify-end">
                        <Badge tone={tone} dot={run.status === "running"}>
                          {run.status}
                        </Badge>
                      </span>
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
