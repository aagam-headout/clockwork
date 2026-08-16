import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, workflows, outputs } from "@/db/schema";
import { requireUser } from "@/lib/auth/user";
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  ListBox,
  PageHeader,
  PageShell,
  SectionLabel,
  StatusDot,
  statusTone,
} from "@/components/ui";
import {
  History,
  ChevronRight,
  Clock,
  Calendar,
  Plus,
  Search,
} from "lucide-react";
import { DigestSearch } from "@/components/digest-search";
import { searchDigests } from "@/lib/data/digest-search";
import { LiveRun } from "@/components/live-run";
import { LocalTime } from "@/components/local-time";
import { formatUsd } from "@/lib/model-tiers";
import { APP_TIMEZONE, daysBetween } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

function relative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
  });
}

/**
 * Group heading for a run's day. "Today"/"Yesterday" are relative to the
 * app's day (see `@/lib/time`), not the host's — so a 1am IST run isn't
 * filed under yesterday.
 */
function dayLabel(date: Date): string {
  const diffDays = daysBetween(new Date(), date);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/*
 * Statuses worth filtering by, ordered by how much they matter when something
 * has gone wrong. Links, not a <select>: keeps the filter in the URL
 * (shareable, survives a refresh) with no client JS.
 */
const FILTERS = [
  { value: "", label: "All" },
  { value: "error", label: "Failed" },
  { value: "running", label: "Running" },
  { value: "ok", label: "OK" },
  { value: "truncated", label: "Truncated" },
] as const;

const PAGE_SIZE = 100;

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; status?: string; q?: string }>;
}) {
  const user = await requireUser();

  // Set when "Run now" hit a workflow already running — surfaced here so
  // the redirect isn't unexplained.
  const { notice, status: statusFilter, q } = await searchParams;
  const query = q?.trim() ?? "";
  const active = FILTERS.some((f) => f.value === statusFilter)
    ? (statusFilter as string)
    : "";

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
      deliveryStatus: outputs.deliveryStatus,
    })
    .from(runs)
    // innerJoin, not leftJoin: a run's owner is its workflow's owner, so this
    // join expresses the scope. (A leftJoin with a WHERE on the joined table
    // degenerates to inner anyway — better to say so.)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    /*
     * leftJoin: a run that failed before producing output has no output row
     * — an innerJoin would drop exactly the runs most worth seeing.
     */
    .leftJoin(outputs, eq(outputs.runId, runs.id))
    .where(
      active
        ? and(eq(workflows.userId, user.id), eq(runs.status, active))
        : eq(workflows.userId, user.id),
    )
    .orderBy(desc(runs.createdAt))
    // One page deep; the filter above handles anything past this, and the
    // footer says so.
    .limit(PAGE_SIZE);

  /*
   * A query searches digests, not run rows — different answer shape, so
   * results replace the list rather than filter it.
   */
  const hits = query
    ? await searchDigests({ userId: user.id, q: query, limit: 25 })
    : [];

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
  // Chip's own wording, so a filtered count reads "3 failed" rather than
  // the awkward "3 error runs".
  const activeLabel = FILTERS.find((f) => f.value === active)?.label ?? "All";

  return (
    <PageShell>
      <PageHeader
        title="Runs"
        subtitle="Every execution of your workflows, newest first."
        actions={
          rows.length === 0 ? undefined : (
            <div className="flex items-center gap-2">
              <LiveRun active={inFlight} />
              {/* Names the filter when one is active — otherwise "12 runs"
                  reads as the total. */}
              <Badge tone={"neutral"} dot>
                {rows.length} {active ? activeLabel.toLowerCase() : "runs"}
                {!active && failed > 0 ? ` · ${failed} failed` : ""}
              </Badge>
              {spend > 0 && (
                <Badge tone="neutral">Cost: {formatUsd(spend)}</Badge>
              )}
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

      <div className="rise mt-6 flex flex-wrap items-center gap-3">
        <DigestSearch initialQuery={query} />
      </div>

      {query ? (
        <DigestResults hits={hits} query={query} />
      ) : (
        <StatusFilter active={active} />
      )}

      {query ? null : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={History}
            title={active ? `No ${active} runs` : "No runs recorded"}
            description={
              active
                ? "Nothing matched that filter."
                : "Runs appear here with their full tool trace — trigger one from a workflow, or wait for its schedule."
            }
            action={
              active ? (
                <ButtonLink href="/runs" variant="outline" size="sm">
                  Clear filter
                </ButtonLink>
              ) : (
                <ButtonLink href="/workflows/new" variant="primary" icon={Plus}>
                  Create a workflow
                </ButtonLink>
              )
            }
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
                      {/* Dot aligns to the title's cap-height, not the
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
                        {/* Separate spans on a fixed gap, not a "·"-joined
                            string — separators used to survive a missing
                            value between them. */}
                        <div className="text-subtle mt-1 flex min-w-0 items-center gap-2.5 font-mono text-[11px] tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <LocalTime value={at} format="time" />
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

                      {/* Fixed-width right columns keep cost and time aligned
                          down the list, not ragged off the name. */}
                      <span className="text-subtle hidden w-16 shrink-0 text-right font-mono text-[11px] tabular-nums sm:block">
                        {run.costUsd != null
                          ? formatUsd(Number(run.costUsd))
                          : ""}
                      </span>
                      <span className="text-subtle hidden w-20 shrink-0 text-right text-[11px] sm:block">
                        {relative(at)}
                      </span>
                      {/* A run can succeed and reach nobody — this badge makes
                          that failure visible where it'd be noticed. */}
                      {(run.deliveryStatus === "failed" ||
                        run.deliveryStatus === "partial") && (
                        <Badge
                          tone={
                            run.deliveryStatus === "failed" ? "danger" : "warn"
                          }
                        >
                          {run.deliveryStatus === "failed"
                            ? "sent nowhere"
                            : "partly sent"}
                        </Badge>
                      )}
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

          {rows.length === PAGE_SIZE && (
            <p className="text-subtle text-center text-xs">
              Showing the {PAGE_SIZE} most recent runs. Narrow it with the
              filter above.
            </p>
          )}
        </div>
      )}
    </PageShell>
  );
}

/**
 * Search results — each digest's matching passage, not its first lines.
 * `ts_headline` produced the excerpt server-side with highlight markers
 * emptied, so it's plain text.
 */
function DigestResults({
  hits,
  query,
}: {
  hits: Array<{
    runId: string;
    workflowName: string;
    date: Date;
    excerpt: string;
    signals: Record<string, unknown> | null;
    severity: string | null;
  }>;
  query: string;
}) {
  if (hits.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={Search}
          title="No digests match"
          description={`Nothing in your digest history mentions "${query}".`}
          action={
            <ButtonLink href="/runs" variant="outline" size="sm">
              Clear search
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="rise mt-6 flex flex-col gap-3">
      <p className="text-subtle text-xs">
        {hits.length} {hits.length === 1 ? "digest" : "digests"} mentioning{" "}
        <span className="text-foreground font-medium">{query}</span>
      </p>
      <ListBox>
        {hits.map((hit) => (
          <Link
            key={hit.runId}
            href={`/runs/${hit.runId}`}
            className="hover:bg-surface-hover group flex flex-col gap-1 px-4 py-3 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="text-foreground truncate text-[13px] font-medium">
                {hit.workflowName}
              </span>
              {hit.severity && (
                <Badge
                  tone={
                    hit.severity === "critical"
                      ? "danger"
                      : hit.severity === "warn"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {hit.severity}
                </Badge>
              )}
              <span className="flex-1" />
              <span className="text-subtle shrink-0 text-xs">
                <LocalTime value={hit.date} format="date" />
              </span>
            </span>
            <span className="text-muted line-clamp-2 text-xs leading-relaxed">
              {hit.excerpt}
            </span>
          </Link>
        ))}
      </ListBox>
    </div>
  );
}

/** The filter row: one chip per status, the active one inverted. */
function StatusFilter({ active }: { active: string }) {
  return (
    <div className="rise mt-6 flex flex-wrap items-center gap-1.5">
      {FILTERS.map((filter) => {
        const on = filter.value === active;
        return (
          <Link
            key={filter.value || "all"}
            href={filter.value ? `/runs?status=${filter.value}` : "/runs"}
            aria-current={on ? "true" : undefined}
            className={`rounded-control flex h-8 items-center px-3 text-[13px] font-medium transition-colors ${
              on
                ? "bg-solid text-solid-fg"
                : "border-border text-muted hover:border-border-strong hover:text-foreground border"
            }`}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}
