import { desc, eq, and, gte, count, sql } from "drizzle-orm";
import { db } from "@/db";
import { outputs, runs, workflows } from "@/db/schema";
import { requireUser } from "@/lib/auth/user";
import { Markdown } from "@/components/markdown";
import { DigestRow } from "@/components/digest-card";
import { LocalDayGreeting } from "@/components/local-time";
import { SetupChecklist } from "@/components/setup-checklist";
import { getOnboardingState } from "@/lib/onboarding";
import { startOfDay } from "@/lib/time";
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
import { Plus, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

/**
 * A row's teaser: the digest's first real line of prose, with markdown
 * furniture (headings, bullets, emphasis, links) stripped to one plain
 * sentence. Cheap and approximate on purpose — a hint, not a rendering.
 */
function previewOf(body: string): string {
  for (const line of body.split("\n")) {
    const text = line
      .replace(/^[#>\s]*[-*+]?\s*/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (text) return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  }
  return "";
}

export default async function TodayPage() {
  const user = await requireUser();

  // App's day, not the host's: on Vercel `setHours(0,0,0,0)` was UTC
  // midnight, so "today" started at 05:30 for an IST reader.
  const startOfToday = startOfDay();

  const [feed, runStats, workflowStats, onboarding] = await Promise.all([
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
      .where(
        and(
          eq(workflows.userId, user.id),
          eq(runs.status, "ok"),
          gte(outputs.createdAt, startOfToday),
          /*
           * The feed is what workflows actually told you today, so both
           * "nothing was sent" states stay out: `unchanged` rows store the
           * NO_UPDATES sentinel as their body (else the card would literally
           * read "NO_UPDATES"), and `suppressed` rows hold a real digest a
           * threshold withheld — showing it here would contradict the run
           * page, which calls it withheld.
           */
          eq(outputs.unchanged, false),
          eq(outputs.suppressed, false),
        ),
      )
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
      // Runs have no owner of their own — they reach one through their
      // workflow, hence the join instead of reading `runs` alone.
      .innerJoin(workflows, eq(runs.workflowId, workflows.id))
      .where(
        and(eq(workflows.userId, user.id), gte(runs.createdAt, startOfToday)),
      ),

    db
      .select({
        total: count(),
        enabled:
          sql<number>`count(*) filter (where ${workflows.enabled})`.mapWith(
            Number,
          ),
      })
      .from(workflows)
      .where(eq(workflows.userId, user.id)),

    getOnboardingState(user.id),
  ]);

  const runsToday = runStats[0]?.total ?? 0;
  const failedToday = runStats[0]?.failed ?? 0;
  const activeWorkflows = workflowStats[0]?.enabled ?? 0;
  const totalWorkflows = workflowStats[0]?.total ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Overview"
        subtitle={<LocalDayGreeting />}
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
          // Amber only when workflows exist but none are running — a fresh
          // install with none at all isn't a fault, though the tile used to
          // read as one.
          tone={
            activeWorkflows > 0
              ? "success"
              : totalWorkflows > 0
                ? "warn"
                : "neutral"
          }
        />
      </div>

      {/* Dissolves step by step, gone once setup is done — a permanent
          banner would be noise on every return visit. */}
      {!onboarding.complete && (
        <div className="mt-6">
          <SetupChecklist state={onboarding} />
        </div>
      )}

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
                <ButtonLink href="/runs" variant="outline">
                  See past runs
                </ButtonLink>
              </div>
            }
          />
        ) : (
          /* One row per digest, not one card: the feed's job is "what ran
             today", and a dozen clamped card bodies buried that in prose.
             The body is one click away in the dialog. */
          <Card className="rise overflow-hidden">
            {feed.map((item) => (
              <DigestRow
                key={item.outputId}
                title={item.workflowName}
                createdAt={item.createdAt}
                preview={previewOf(item.body)}
                badge={
                  item.deliveredTo.length > 0 ? (
                    <Badge tone="neutral">{item.deliveredTo.join(" · ")}</Badge>
                  ) : undefined
                }
                meta={
                  item.deliveredTo.length > 0
                    ? `Delivered to ${item.deliveredTo.join(", ")}`
                    : undefined
                }
                viewRunHref={`/runs/${item.runId}`}
                rendered={<Markdown digest>{item.body}</Markdown>}
              />
            ))}
          </Card>
        )}
      </div>
    </PageShell>
  );
}
