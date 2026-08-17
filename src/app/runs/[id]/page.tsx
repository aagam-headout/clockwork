import Link from "next/link";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runSteps, outputs, runs, workflows } from "@/db/schema";
import { currentUser, requireUser } from "@/lib/auth/user";
import { ownedRun, ownedRunOr404 } from "@/lib/data/scope";
import { traceWindowPassed } from "@/lib/retention";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  ListBox,
  PageHeader,
  PageShell,
  SectionLabel,
  Stat,
  statusTone,
} from "@/components/ui";
import {
  Wrench,
  Search,
  AlignLeft,
  XCircle,
  CheckCircle2,
  Timer,
  Hammer,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  FileText,
  ListTree,
  Send,
  SquarePen,
  Gauge,
  GitBranch,
  ChevronRight,
} from "lucide-react";
import { LiveRun } from "@/components/live-run";
import { TraceToggleAll, PayloadView } from "@/components/trace-tools";
import { Markdown } from "@/components/markdown";
import { DigestCard } from "@/components/digest-card";
import { LocalTime } from "@/components/local-time";
import { formatUsd } from "@/lib/model-tiers";
import { SYSTEM_TOOL_NAMES } from "@/lib/agent/system-tools";

export const dynamic = "force-dynamic";

// `query`/`inspect` are engine-owned reads of an already-fetched payload, not
// connector calls — marked distinctly so "why so many steps" doesn't read as
// "why so many fetches".
const SYSTEM_TOOLS = new Set<string>(SYSTEM_TOOL_NAMES);

// GH Actions renders step durations as "1m 4s", not raw milliseconds.
function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Scoped, like the page: `generateMetadata` runs on its own, so an
  // unscoped lookup here leaked another user's workflow name and run status
  // into the tab title even when the page itself 404'd.
  const user = await currentUser();
  const row = user ? await ownedRun(id, user.id) : null;
  if (!row) return { title: "Run" };
  return { title: `${row.workflow.name} · ${row.run.status}` };
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  const { id } = await params;

  // 404 for someone else's run, identical to one that never existed — the
  // worst page to leave unscoped, since steps and output carry the full
  // digest body and every tool result.
  const owned = await ownedRunOr404(id, user.id);
  const run = {
    ...owned.run,
    workflowName: owned.workflow.name,
    workflowId: owned.workflow.id,
    workflowModel: owned.workflow.model,
  };

  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, id))
    .orderBy(asc(runSteps.idx));

  const [output] = await db.select().from(outputs).where(eq(outputs.runId, id));

  // Where a chained run came from. Scoped through `workflows.userId` like
  // every other read here — the parent belongs to the same owner by
  // construction, but the query says so itself rather than inheriting the
  // check above.
  const [parentRun] = run.parentRunId
    ? await db
        .select({ id: runs.id, workflowName: workflows.name })
        .from(runs)
        .innerJoin(workflows, eq(runs.workflowId, workflows.id))
        .where(and(eq(runs.id, run.parentRunId), eq(workflows.userId, user.id)))
        .limit(1)
    : [];

  const tone = statusTone(run.status);
  const toolCalls = steps.filter((s) => s.type === "tool").length;
  // Only connector calls spend the step budget (see countExternalSteps in
  // src/lib/agent/wrap-tools.ts). Split out so a truncated run's count
  // doesn't read as "too many fetches" when most were free query/inspect reads.
  const systemCalls = steps.filter(
    (s) => s.type === "tool" && SYSTEM_TOOLS.has(s.toolSlug ?? ""),
  ).length;
  const connectorCalls = toolCalls - systemCalls;
  const inFlight = run.status === "running" || run.status === "queued";
  const deliveryLog = (output?.deliveryLog ?? []) as Array<{
    type: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
  }>;

  // A run past the trace window kept its digest but lost its steps — different
  // from a run that never took any.
  const tracePruned = steps.length === 0 && traceWindowPassed(run.createdAt);

  const signals = Object.entries(
    (output?.signals ?? {}) as Record<string, unknown>,
  );

  // `suppressedReason` does double duty: on a withheld digest it says why; on
  // a delivered one it carries the "delivered anyway" notes. Only the latter
  // belongs in a warning next to a digest that went out.
  const reason = output?.suppressedReason ?? null;
  const conditionNote =
    reason === "condition_indeterminate"
      ? "A signal the condition needs was not reported, so the digest was sent."
      : reason?.startsWith("condition_error")
        ? `${reason.replace(/^condition_error: /, "")} — the digest was sent.`
        : null;

  return (
    <PageShell>
      <PageHeader
        backHref="/runs"
        backLabel="Runs"
        title={run.workflowName ?? "(deleted workflow)"}
        subtitle={
          // Announced: LiveRun re-renders this header every 3s in flight, and
          // the status change was otherwise silent to a screen reader.
          <span
            aria-live="polite"
            className="inline-flex flex-wrap items-center gap-2"
          >
            <Badge tone={tone} dot={inFlight}>
              {run.status}
            </Badge>
            <Badge tone="neutral">{run.trigger}</Badge>
            {parentRun && (
              <Link
                href={`/runs/${parentRun.id}`}
                className="text-muted hover:text-foreground inline-flex items-center gap-1 text-[13px] transition-colors"
              >
                <GitBranch className="h-3.5 w-3.5" />
                after {parentRun.workflowName}
              </Link>
            )}
            <span>
              {run.startedAt ? (
                <LocalTime value={run.startedAt} format="datetime" />
              ) : (
                "Not started"
              )}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <LiveRun active={inFlight} />
            {run.workflowId && (
              <ButtonLink
                href={`/workflows/${run.workflowId}`}
                variant="outline"
                size="sm"
                icon={SquarePen}
              >
                Edit workflow
              </ButtonLink>
            )}
          </div>
        }
      />

      <div className="rise mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          icon={Timer}
          label="Duration"
          value={
            run.durationMs != null
              ? `${(run.durationMs / 1000).toFixed(1)}s`
              : "—"
          }
          hint={
            run.finishedAt ? (
              <LocalTime value={run.finishedAt} format="time" prefix="ended " />
            ) : inFlight ? (
              "in flight"
            ) : undefined
          }
          tone={tone}
        />
        <Stat
          icon={Hammer}
          label="Tool calls"
          value={toolCalls}
          hint={
            systemCalls > 0
              ? `${connectorCalls} connector · ${systemCalls} system`
              : `${steps.length} steps total`
          }
        />
        <Stat
          icon={ArrowDownToLine}
          label="Tokens in"
          value={
            run.inputTokens != null ? run.inputTokens.toLocaleString() : "—"
          }
          hint={
            run.inputTokens != null && run.outputTokens != null
              ? `${(run.inputTokens + run.outputTokens).toLocaleString()} total`
              : undefined
          }
        />
        <Stat
          icon={ArrowUpFromLine}
          label="Tokens out"
          value={
            run.outputTokens != null ? run.outputTokens.toLocaleString() : "—"
          }
          hint={run.finishReason ? `finish: ${run.finishReason}` : undefined}
        />
        <Stat
          icon={DollarSign}
          label="Cost"
          value={formatUsd(
            run.costUsd != null ? Number(run.costUsd) : undefined,
          )}
          hint={
            run.workflowModel ? run.workflowModel.split("/").pop() : undefined
          }
        />
      </div>

      {run.error &&
        // A connection problem is the one failure the reader can fix here, so
        // it gets its own tone and link instead of an opaque error string.
        (run.errorCode === "needs_reconnect" ? (
          <div className="mt-6">
            <Alert tone="warn" title="Connection needs reconnecting">
              <p>{run.error}</p>
              {/* One link, not one per toolkit: they all went to the same
                  page, so a row of them read as separate destinations. */}
              <p className="mt-2">
                <Link
                  href="/connections"
                  className="underline underline-offset-2"
                >
                  {run.errorToolkits.length > 0
                    ? `Reconnect ${run.errorToolkits
                        .map((slug) => TOOLKIT_LABELS[slug] ?? slug)
                        .join(", ")}`
                    : "Go to connections"}
                </Link>
              </p>
            </Alert>
          </div>
        ) : run.errorCode === "missing_provider_key" ? (
          <div className="mt-6">
            <Alert tone="warn" title="No API key on this account">
              <p>{run.error}</p>
              <p className="mt-2">
                <Link
                  href="/account/model-provider"
                  className="underline underline-offset-2"
                >
                  Add a key
                </Link>
              </p>
            </Alert>
          </div>
        ) : (
          <div className="mt-6">
            <Alert
              tone={run.status === "truncated" ? "warn" : "danger"}
              title={
                run.status === "truncated" ? "Run cut short" : "Run failed"
              }
            >
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {run.error}
              </pre>
            </Alert>
          </div>
        ))}

      {output && (
        <section className="mt-8">
          <SectionLabel icon={FileText}>Output</SectionLabel>

          {signals.length > 0 && (
            <Card className="mb-3 overflow-hidden">
              <div className="border-border bg-bg-subtle text-subtle flex items-center gap-1.5 border-b px-5 py-2.5 text-xs">
                <Gauge className="h-3.5 w-3.5" />
                Signals
                {output.severity && (
                  <Badge
                    tone={
                      output.severity === "critical"
                        ? "danger"
                        : output.severity === "warn"
                          ? "warn"
                          : "neutral"
                    }
                    className="ml-1"
                  >
                    {output.severity}
                  </Badge>
                )}
              </div>
              <dl className="divide-border divide-y">
                {signals.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-baseline justify-between gap-4 px-5 py-2.5"
                  >
                    <dt className="text-muted font-mono text-[13px]">{key}</dt>
                    <dd className="text-foreground font-mono text-[13px] tabular-nums">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {/* A withheld digest is shown, not hidden — otherwise the feature is
              indistinguishable from the agent finding nothing. */}
          {output.suppressed && (
            <div className="mb-3">
              <Alert tone="neutral" title="Withheld — alert condition not met">
                {output.suppressedReason ?? "The condition evaluated false."}
              </Alert>
            </div>
          )}

          {/* The threshold did not actually gate this delivery, so say so
              rather than letting a green run imply the condition held. */}
          {!output.suppressed && conditionNote && (
            <div className="mb-3">
              <Alert tone="warn" title="Alert condition could not be checked">
                {conditionNote}
              </Alert>
            </div>
          )}

          <Card className="overflow-hidden">
            {output.unchanged ? (
              <div className="px-5 py-4.5">
                <span className="text-muted text-sm italic">
                  Nothing new since the previous digest — nothing was sent.
                </span>
              </div>
            ) : (
              // Body is markdown the agent wrote for Slack/email; rendered as-is
              // rather than shown as source. No `viewRunHref` — already on it.
              <DigestCard
                title={run.workflowName ?? "(deleted workflow)"}
                createdAt={output.createdAt}
                rendered={<Markdown digest>{output.body}</Markdown>}
              />
            )}
            <div className="border-border bg-bg-subtle text-subtle flex flex-wrap items-center gap-2 border-t px-5 py-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Delivery
              </span>
              {output.deliveryStatus === "failed" && (
                <Badge tone="danger">sent nowhere</Badge>
              )}
              {output.deliveryStatus === "partial" && (
                <Badge tone="warn">partly sent</Badge>
              )}
              {output.deliveryAttempts > 1 && (
                <span>{output.deliveryAttempts} attempts</span>
              )}
              {deliveryLog.length === 0 && <span>—</span>}
              {/* Three states, not two: delivered, deliberately skipped
                  because there was nothing new, and actually failed. */}
              {deliveryLog.map((entry) => (
                <span
                  key={entry.type}
                  title={entry.error}
                  className="inline-flex items-center"
                >
                  <Badge
                    tone={
                      entry.ok ? "success" : entry.skipped ? "neutral" : "warn"
                    }
                  >
                    {entry.type}
                    {entry.ok ? "" : entry.skipped ? " · skipped" : " · failed"}
                  </Badge>
                </span>
              ))}
            </div>
          </Card>
        </section>
      )}

      <section className="mt-8">
        <SectionLabel
          icon={ListTree}
          count={steps.length}
          action={
            steps.length > 0 ? <TraceToggleAll scope="trace" /> : undefined
          }
        >
          Trace
        </SectionLabel>

        {steps.length === 0 ? (
          <p className="rounded-container border-border bg-bg-subtle text-muted border px-4 py-8 text-center text-sm">
            {/* Traces prune well before the digest — a kept run can outlive its
                steps by months. Worth saying, or an empty trace on an old
                successful run reads as "this run did nothing". */}
            {tracePruned
              ? "Trace pruned. The digest is kept."
              : "No steps recorded for this run."}
          </p>
        ) : (
          // Modeled on the GitHub Actions job log: a bordered list of steps,
          // each a summary line (status glyph, name, duration) expanding into
          // a recessed monospace panel. Failed steps open themselves.
          <ListBox as="ol" id="trace">
            {steps.map((step, i) => {
              const isTool = step.type === "tool";
              const isSystemTool =
                isTool && SYSTEM_TOOLS.has(step.toolSlug ?? "");
              const failed = Boolean(step.error);
              const text =
                (step.resultJson as { text?: string } | null)?.text ?? "";
              // Only `query` returns this, and only when `offset`/`take`
              // actually paged an array or a long string — see
              // src/lib/agent/system-tools/query.ts.
              const truncated =
                (step.resultJson as { truncated?: boolean } | null)
                  ?.truncated === true;
              return (
                <li key={step.id}>
                  <details className="group" open={failed}>
                    <summary className="hover:bg-surface-hover flex h-9 cursor-pointer list-none items-center gap-2.5 px-3 transition-colors">
                      <span className="text-subtle w-4 shrink-0 text-right font-mono text-[11px] tabular-nums">
                        {i + 1}
                      </span>
                      <span
                        className={`shrink-0 ${failed ? "text-danger" : "text-success"}`}
                      >
                        {failed ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="text-subtle shrink-0">
                        {isTool ? (
                          isSystemTool ? (
                            <Search className="h-3 w-3" />
                          ) : (
                            <Wrench className="h-3 w-3" />
                          )
                        ) : (
                          <AlignLeft className="h-3 w-3" />
                        )}
                      </span>
                      {isTool ? (
                        <span
                          className={`truncate font-mono text-xs font-medium ${
                            isSystemTool ? "text-muted" : "text-foreground"
                          }`}
                        >
                          {step.toolSlug}
                        </span>
                      ) : (
                        // Reasoning rows are titled by their own first line, so
                        // a collapsed trace still reads as a narrative.
                        <span className="text-muted truncate text-xs">
                          {text.trim().split("\n")[0] || "reasoning"}
                        </span>
                      )}
                      {truncated && (
                        <Badge tone="warn" mono className="shrink-0">
                          more available
                        </Badge>
                      )}
                      <span className="flex-1" />
                      {step.durationMs != null && (
                        <span className="text-subtle shrink-0 font-mono text-[11px] tabular-nums">
                          {formatStepDuration(step.durationMs)}
                        </span>
                      )}
                      <ChevronRight className="text-subtle h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
                    </summary>

                    {/* Theme tokens, not a pinned-dark terminal: a panel that
                        stays black in a light app is a second theme on one page.
                        Monospace type and the recessed surface already read as
                        "this is a log" on their own. */}
                    <div className="border-border bg-bg-subtle space-y-2 border-t px-3 py-2.5 pl-[38px] font-mono text-[11px] leading-relaxed">
                      {step.error && (
                        <p className="text-danger-text">
                          <span className="text-subtle">##[error] </span>
                          {step.error}
                        </p>
                      )}
                      {isTool ? (
                        // Two labelled blocks, not one `{args, result}` blob:
                        // "what did it send" and "what came back" are answered
                        // one at a time.
                        <div className="space-y-2">
                          <Payload label="args" data={step.argsJson} />
                          <Payload label="result" data={step.resultJson} />
                        </div>
                      ) : (
                        // `.markdown` uses the same theme vars as everything
                        // else, so no local overrides needed. Capped like a
                        // payload: an uncapped chain of thought would bury
                        // every step after it.
                        // The negative margin plus matching padding keeps the
                        // text where it was while giving the scrollport room
                        // for a list marker, which is painted left of the
                        // content and was otherwise sheared at this edge.
                        <div className="-ml-4 max-h-84 overflow-auto pl-4">
                          <Markdown>{text}</Markdown>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ListBox>
        )}
      </section>
    </PageShell>
  );
}

/**
 * The plain-text reading of a payload, when it has one.
 *
 * A tool returning prose does so as `{ text: "…" }`, and JSON escapes every
 * newline — so the JSON view of a long answer is one unreadable line of
 * `\n`s. That text earns its own view; structured data gets no second tab.
 */
function plainText(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const text = (data as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text;
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One labelled block inside the log panel — `args` or `result`.
 *
 * Serialized here, server-side: `PayloadView` only lays out strings it's
 * handed, so a 200KB result is stringified once, not on every re-render.
 */
function Payload({ label, data }: { label: string; data: unknown }) {
  const json = JSON.stringify(data, null, 2) ?? "undefined";
  return (
    <PayloadView
      label={label}
      json={json}
      text={plainText(data)}
      size={formatBytes(Buffer.byteLength(json))}
    />
  );
}
