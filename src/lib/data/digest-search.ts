import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { outputs, runs, workflows } from "@/db/schema";

/*
 * One search over the digest corpus, serving two callers: the /runs search
 * box and the agent's `history` tool.
 *
 * Sharing the function is what makes owner scoping trustworthy. The join to
 * `workflows` and the filter on `workflows.userId` are structural, not
 * optional arguments — neither caller can widen past the owner, and a tool
 * parameter certainly can't.
 */

export const MAX_SEARCH_LIMIT = 50;
const DEFAULT_LIMIT = 10;

/** Points one sparkline may read. More than this is not a chart, it is a scan. */
export const MAX_TIMELINE_POINTS = 500;

export type DigestHit = {
  runId: string;
  workflowId: string;
  workflowName: string;
  date: Date;
  excerpt: string;
  signals: Record<string, unknown> | null;
  severity: string | null;
};

export type SearchArgs = {
  userId: string;
  /** Narrows to one workflow. Omitted means every workflow this user owns. */
  workflowId?: string;
  q?: string;
  since?: Date;
  limit?: number;
};

/** "30d", "2w", "6m" — a window, not a date. Months are 30 days, deliberately. */
export function parseSince(
  input: string | undefined,
  now: Date = new Date(),
): { ok: true; date: Date | undefined } | { ok: false; error: string } {
  if (!input) return { ok: true, date: undefined };

  const match = /^(\d+)\s*([dwm])$/i.exec(input.trim());
  if (!match) {
    return {
      ok: false,
      error: `could not read "${input}" — use a number followed by d, w or m, for example "90d"`,
    };
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "the window must be a positive number" };
  }

  const unit = match[2].toLowerCase();
  const days = unit === "d" ? 1 : unit === "w" ? 7 : 30;
  return {
    ok: true,
    date: new Date(now.getTime() - amount * days * 86_400_000),
  };
}

export async function searchDigests(args: SearchArgs): Promise<DigestHit[]> {
  const limit = Math.min(
    Math.max(1, args.limit ?? DEFAULT_LIMIT),
    MAX_SEARCH_LIMIT,
  );

  const query = args.q?.trim();

  const conditions = [eq(workflows.userId, args.userId)];
  if (args.workflowId) conditions.push(eq(runs.workflowId, args.workflowId));
  if (args.since) conditions.push(gte(outputs.createdAt, args.since));
  if (query) {
    conditions.push(
      sql`${outputs.searchVector} @@ websearch_to_tsquery('english', ${query})`,
    );
  }
  /*
   * An unchanged run's body holds the literal `NO_UPDATES` sentinel, not
   * empty text — filtering on body alone let that string surface as a search
   * hit. The empty-body check stays for failure-path rows, which have neither
   * a digest nor the flag.
   */
  conditions.push(eq(outputs.unchanged, false));
  conditions.push(sql`${outputs.body} <> ''`);

  /*
   * `ts_headline` returns the matched passage, not the first 200 characters
   * of a digest that mentions the term at the bottom.
   *
   * StartSel/StopSel are emptied on purpose: the default wraps matches in
   * <b>, which would mean rendering database-derived HTML just to bold a
   * search result.
   */
  const excerpt = query
    ? sql<string>`ts_headline('english', ${outputs.body}, websearch_to_tsquery('english', ${query}), 'MaxWords=40, MinWords=20, ShortWord=3, MaxFragments=2, StartSel="", StopSel=""')`
    : sql<string>`left(${outputs.body}, 240)`;

  const rows = await db
    .select({
      runId: runs.id,
      workflowId: workflows.id,
      workflowName: workflows.name,
      date: outputs.createdAt,
      excerpt,
      signals: outputs.signals,
      severity: outputs.severity,
    })
    .from(outputs)
    .innerJoin(runs, eq(outputs.runId, runs.id))
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(and(...conditions))
    .orderBy(
      query
        ? desc(
            sql`ts_rank(${outputs.searchVector}, websearch_to_tsquery('english', ${query}))`,
          )
        : desc(outputs.createdAt),
      desc(outputs.createdAt),
    )
    .limit(limit);

  return rows as DigestHit[];
}

export type SignalPoint = { date: Date; signals: Record<string, unknown> };

/**
 * Every reported signal for one workflow, oldest first.
 *
 * No full-text, no new index: `runs_workflow_created_idx` already covers
 * this access path. A jsonb index on `signals` isn't justified until
 * something filters on a signal's value rather than just reading it.
 */
export async function signalTimeline(
  userId: string,
  workflowId: string,
  /** How far back to read, in days. A count, not a Date, so the clock read
   * happens here — a server component can't call `Date.now()` during render
   * without tripping React's purity rule. */
  days: number,
): Promise<SignalPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000);

  /*
   * Newest first with a cap, then reversed for the caller. The window alone
   * isn't a bound — an event-triggered workflow can produce hundreds of runs
   * a day, more than a chart can draw pixels for. Taking the newest keeps the
   * recent end of the series instead of whatever the window starts with.
   */
  const rows = await db
    .select({ date: outputs.createdAt, signals: outputs.signals })
    .from(outputs)
    .innerJoin(runs, eq(outputs.runId, runs.id))
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(
      and(
        eq(workflows.userId, userId),
        eq(runs.workflowId, workflowId),
        gte(outputs.createdAt, since),
        sql`${outputs.signals} is not null`,
      ),
    )
    .orderBy(desc(outputs.createdAt))
    .limit(MAX_TIMELINE_POINTS);

  return (rows as SignalPoint[]).reverse();
}
