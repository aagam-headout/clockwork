"use server";

import { eq, like, ne, and, inArray, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun, executeRun } from "@/lib/executor";
import { deleteConnectedAccount, composioErrorMessage } from "@/lib/composio";
import { syncEventTriggers } from "@/lib/triggers";
import type { DeliverTarget } from "@/lib/read-only";
import { requireUser } from "@/lib/auth/user";
import { ownedWorkflow } from "@/lib/data/scope";
import {
  DELIVER_TOOLKITS,
  getUserConnection,
  getUserConnections,
  markDisconnected,
  workflowsUsingToolkit,
} from "@/lib/data/connections";
import { TOOLKIT_LABELS } from "@/lib/toolkit-labels";
import { LIMITS } from "@/lib/limits";
import { minIntervalMinutes } from "@/lib/schedule";
import { assertSafeWebhookUrl } from "@/lib/net/safe-url";
import { validateChain } from "@/lib/chain";
import { parseCondition, type SignalDecl } from "@/lib/outcome/condition";
import { parseSignalSchema } from "@/lib/outcome/envelope";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") ||
    // Every character was punctuation ("!!!"), which would otherwise insert an
    // empty slug — and the second such workflow would hit the unique index.
    "workflow"
  );
}

/**
 * `workflows.slug` is unique, and two workflows called "Morning digest" is an
 * entirely reasonable thing to want. Without this, the second save died on a
 * Postgres constraint violation — which reached the user as an unexplained
 * error screen with the filled-in form gone.
 *
 * Scoped to the owner, which matters twice over now that there is more than
 * one: unscoped, one user naming a workflow "digest" would push the next
 * person's to "digest-2", and the suffix they got back would tell them whether
 * a stranger already owns that name.
 */
async function uniqueSlug(
  userId: string,
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name);

  const scoped = and(
    eq(workflows.userId, userId),
    like(workflows.slug, `${base}%`),
  );

  const taken = new Set(
    (
      await db
        .select({ slug: workflows.slug })
        .from(workflows)
        .where(excludeId ? and(scoped, ne(workflows.id, excludeId)) : scoped)
    ).map((row) => row.slug),
  );

  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  // 999 workflows sharing a name is not a real case; a timestamp ends it.
  return `${base}-${Date.now()}`;
}

/**
 * What a workflow form action hands back to the page. `null` means the save
 * went through — though on that path the action redirects and the state is
 * never rendered.
 *
 * Returning the message instead of throwing is the whole point: a thrown
 * validation error ("Name, goal, and at least one toolkit are required") hit
 * the error boundary, replacing the page — and every field the user had just
 * filled in — with a generic failure screen.
 */
export type WorkflowFormState = {
  error: string | null;
  /**
   * What was submitted, echoed back. React resets an uncontrolled form once
   * its action settles — so without this, a rejected save cleared every field
   * the user had just typed and left them retyping the whole thing to fix one
   * mistake. The form re-seeds its `defaultValue`s from here.
   */
  values?: Record<string, string>;
};

/** FormData as plain strings; multi-value fields are held in React state. */
function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * Next signals both `redirect()` and `notFound()` by throwing a tagged error.
 * `requireUser()` redirects, so every catch in this file sits downstream of
 * one — and swallowing it would show "NEXT_REDIRECT" as the error message
 * while leaving an unauthorized caller on the page.
 */
function isControlFlowError(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest === "NEXT_HTTP_ERROR_FALLBACK;404")
  );
}

/** Anything that reaches the user, in one shape, with the cause preserved. */
function actionError(err: unknown, formData?: FormData): WorkflowFormState {
  if (isControlFlowError(err)) throw err;
  console.error("[workflow action]", err);
  return {
    error:
      err instanceof Error && err.message
        ? err.message
        : "Something went wrong saving this workflow.",
    values: formData ? formValues(formData) : undefined,
  };
}

function field(formData: FormData, key: string, fallback = "") {
  return String(formData.get(key) ?? fallback).trim();
}

/**
 * Delivery targets, each gated on its own checkbox. A checked target with an
 * empty destination is a user error worth surfacing, not a silent drop.
 */
async function parseDeliver(formData: FormData): Promise<DeliverTarget[]> {
  const deliver: DeliverTarget[] = [{ type: "dashboard" }];

  if (formData.get("deliverSlack") === "on") deliver.push({ type: "slack_dm" });

  if (formData.get("deliverSlackChannel") === "on") {
    const channel = field(formData, "slackChannel");
    if (!channel) throw new Error("Slack channel delivery needs a channel.");
    deliver.push({ type: "slack_channel", channel });
  }

  if (formData.get("deliverEmail") === "on") {
    const to = field(formData, "emailTo");
    if (!to) throw new Error("Email delivery needs a recipient address.");
    deliver.push({ type: "email", to });
  }

  if (formData.get("deliverWebhook") === "on") {
    const url = field(formData, "webhookUrl");
    // Resolves DNS and rejects anything on a private network — this server
    // fetches the URL later, so an unchecked one is an SSRF primitive.
    await assertSafeWebhookUrl(url);
    deliver.push({ type: "webhook", url });
  }

  if (deliver.length > LIMITS.maxDeliverTargets) {
    throw new Error(
      `A workflow can have at most ${LIMITS.maxDeliverTargets} delivery targets.`,
    );
  }

  return deliver;
}

/**
 * Checks delivery targets against the user's actual connections.
 *
 * The split matters. **No connection row at all** means the user is saving
 * something that cannot work and has no way to find out why except by waiting
 * for the first run to fail — so that's rejected. **A row that exists but is
 * unhealthy** is transient, and blocking it would trap someone who only wanted
 * to rename a workflow while their Slack token happens to be expired — so that
 * is allowed with a warning.
 */
async function checkDeliveryConnections(
  userId: string,
  deliver: DeliverTarget[],
): Promise<string[]> {
  const needed = new Set(
    deliver
      .map((target) => DELIVER_TOOLKITS[target.type])
      .filter((slug): slug is string => Boolean(slug)),
  );
  if (needed.size === 0) return [];

  const byToolkit = new Map(
    (await getUserConnections(userId)).map((c) => [c.toolkit, c]),
  );
  const warnings: string[] = [];

  for (const toolkit of needed) {
    const label = TOOLKIT_LABELS[toolkit] ?? toolkit;
    const conn = byToolkit.get(toolkit);

    if (!conn || conn.status === "disconnected") {
      throw new Error(
        `${label} delivery needs a ${label} connection — connect it under Connections first.`,
      );
    }
    if (!conn.usable) {
      warnings.push(
        `${label} needs reconnecting — this workflow won't deliver until it does.`,
      );
    }
  }

  return warnings;
}

async function parseWorkflowForm(
  formData: FormData,
  userId: string,
  /** The workflow being edited, so it is excluded from its own cycle and
   * fan-out checks. Null when creating. */
  workflowId: string | null = null,
) {
  const name = field(formData, "name");
  const goal = field(formData, "goal");
  const rawTriggerType = field(formData, "triggerType", "cron");
  const triggerType =
    rawTriggerType === "event" || rawTriggerType === "workflow"
      ? rawTriggerType
      : "cron";
  const cron = field(formData, "cron");
  const timezone = field(formData, "timezone", "Asia/Kolkata");
  const model = field(formData, "model", "anthropic/claude-sonnet-5");
  /*
   * Clamped, not trusted. The builder's schema caps this at 30, but this path
   * is a plain form post — and a server action is an ordinary endpoint anyone
   * with a session can call directly, so `maxSteps=100000` would otherwise buy
   * a full-length run at maximum tool-call rate.
   */
  const maxSteps = Math.min(
    Math.max(1, Math.floor(Number(formData.get("maxSteps")) || 15)),
    LIMITS.maxSteps,
  );
  // Read-only is the default, so the form ships the opt-out ("allowWrites")
  // rather than the flag itself — an absent checkbox then means "stay safe".
  const readOnly = formData.get("allowWrites") !== "on";
  const toolkits = formData.getAll("toolkits").map(String);
  const eventTriggers = formData
    .getAll("eventTriggers")
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean);
  const allowTools = splitList(field(formData, "allowTools"));
  const denyTools = splitList(field(formData, "denyTools"));

  const deliver = await parseDeliver(formData);

  /*
   * The outcome configuration: what the run may measure, and the two gates
   * those measurements feed. Validated here rather than at run time on
   * purpose — a typo in a threshold should be a red field in a form, not a
   * surprise at 6am three weeks later on a workflow everyone assumed was
   * watching something.
   */
  const signalSchema = parseSignalSchema(
    jsonField(formData, "signalSchema") ?? [],
  );
  const alertCondition = field(formData, "alertCondition") || null;
  const parentWorkflowId = field(formData, "parentWorkflowId") || null;
  const parentCondition = field(formData, "parentCondition") || null;

  if (!name || !goal || toolkits.length === 0) {
    throw new Error("Name, goal, and at least one toolkit are required.");
  }
  if (triggerType === "cron" && !cron) {
    throw new Error("A scheduled workflow needs a cron expression.");
  }
  if (triggerType === "event" && eventTriggers.length === 0) {
    throw new Error("An event workflow needs at least one trigger.");
  }
  if (triggerType === "workflow" && !parentWorkflowId) {
    throw new Error("A chained workflow needs a workflow to run after.");
  }

  await assertOutcomeConfig(userId, workflowId, {
    signalSchema,
    alertCondition,
    parentWorkflowId: triggerType === "workflow" ? parentWorkflowId : null,
    parentCondition,
  });
  if (eventTriggers.length > LIMITS.maxEventTriggers) {
    throw new Error(
      `A workflow can subscribe to at most ${LIMITS.maxEventTriggers} triggers.`,
    );
  }

  if (triggerType === "cron") {
    // Only a cron workflow has a schedule to police. An event or chained one
    // is woken by something else entirely.
    // The scheduler ticks every 5 minutes, so a faster cron is a schedule the
    // app cannot honour — and the cheapest way for one account to monopolise
    // the tick.
    let interval: number;
    try {
      interval = minIntervalMinutes(cron, timezone);
    } catch {
      throw new Error(`"${cron}" isn't a valid cron expression.`);
    }
    if (interval < LIMITS.minCronIntervalMinutes) {
      throw new Error(
        `That schedule runs every ${Math.round(interval)} minutes. ` +
          `The minimum is ${LIMITS.minCronIntervalMinutes} minutes.`,
      );
    }
  }

  const warnings = await checkDeliveryConnections(userId, deliver);

  return {
    warnings,
    name,
    goal,
    triggerType,
    // An event or chained workflow has no schedule; keep the column non-null
    // and empty so the dispatcher never considers it due.
    cron: triggerType === "cron" ? cron : "",
    timezone,
    model,
    maxSteps,
    readOnly,
    toolkits,
    eventTriggers,
    allowTools,
    denyTools,
    deliver,
    signalSchema,
    alertCondition,
    // Only a chained workflow keeps a parent. Switching a workflow back to
    // cron must clear the link, or it stays in its old parent's fan-out and
    // silently counts against that limit.
    parentWorkflowId: triggerType === "workflow" ? parentWorkflowId : null,
    parentCondition: triggerType === "workflow" ? parentCondition : null,
  };
}

/** A JSON-encoded hidden field, as the multi-value parts of the form post. */
function jsonField(formData: FormData, key: string): unknown {
  const raw = field(formData, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not read the ${key} field.`);
  }
}

/**
 * Everything about a workflow's outcome configuration that must hold before
 * the row is written. Throws, matching how the rest of this file reports a
 * validation failure back to the form.
 */
async function assertOutcomeConfig(
  userId: string,
  workflowId: string | null,
  input: {
    signalSchema: SignalDecl[];
    alertCondition: string | null;
    parentWorkflowId: string | null;
    parentCondition: string | null;
  },
): Promise<void> {
  const declared = input.signalSchema;

  if (declared.length > LIMITS.maxSignalsPerWorkflow) {
    throw new Error(
      `A workflow can declare at most ${LIMITS.maxSignalsPerWorkflow} signals.`,
    );
  }

  const seen = new Set<string>();
  for (const decl of declared) {
    if (!/^[a-z][a-z0-9_]*$/.test(decl.key)) {
      throw new Error(
        `Signal name "${decl.key}" must be lowercase letters, digits and underscores, starting with a letter.`,
      );
    }
    if (seen.has(decl.key)) {
      throw new Error(`Duplicate signal name "${decl.key}".`);
    }
    seen.add(decl.key);
  }

  if (input.alertCondition?.trim()) {
    const parsed = parseCondition(input.alertCondition, declared);
    if (!parsed.ok) throw new Error(`Alert condition: ${parsed.error}`);
  }

  if (!input.parentWorkflowId) {
    if (input.parentCondition?.trim()) {
      throw new Error(
        "A trigger condition needs a parent workflow to read signals from.",
      );
    }
    return;
  }

  /*
   * Scoped to the owner. A parent id belonging to someone else is simply
   * absent from this list, so it reads as "not found" rather than as a
   * permission error — which would confirm the row exists.
   */
  const owned = await db
    .select({
      id: workflows.id,
      parentWorkflowId: workflows.parentWorkflowId,
      signalSchema: workflows.signalSchema,
    })
    .from(workflows)
    .where(eq(workflows.userId, userId));

  const chain = validateChain(workflowId, input.parentWorkflowId, owned);
  if (!chain.ok) throw new Error(chain.error);

  if (input.parentCondition?.trim()) {
    // The condition reads the PARENT's signals, not this workflow's.
    const parent = owned.find((w) => w.id === input.parentWorkflowId);
    const parsed = parseCondition(
      input.parentCondition,
      parseSignalSchema(parent?.signalSchema),
    );
    if (!parsed.ok) throw new Error(`Trigger condition: ${parsed.error}`);
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Registering the trigger with Composio is best-effort: the workflow is
 * already saved and correct, and a Composio hiccup shouldn't lose the edit.
 * A trigger that failed to register simply never fires, which is invisible
 * from the workflow list — so the reason comes back as a string for the
 * caller to show. Re-saving the workflow retries it.
 */
async function registerTriggers(userId: string): Promise<string | null> {
  try {
    const results = await syncEventTriggers(userId);
    const failed = results.filter((r) => !r.ok);
    for (const r of failed) {
      console.error(`[triggers] failed to register ${r.slug}: ${r.error}`);
    }
    if (failed.length === 0) return null;
    // The console line above is invisible to the person who just hit Save;
    // this string rides back to /workflows as a warning banner.
    return failed.map((r) => `${r.slug}: ${r.error}`).join(" · ");
  } catch (err) {
    console.error("[triggers] registration failed", err);
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * `/workflows`, plus the trigger warning when registration didn't take — or,
 * when it did, a line saying the save landed. Every one of these actions ends
 * in a redirect, and a redirect that changes nothing visible ("did the pause
 * take?") is indistinguishable from a no-op, so the successful paths carry a
 * `done` message the same way the failing ones carry `error`.
 */
function workflowsPath(triggerError: string | null, done?: string) {
  if (triggerError)
    return `/workflows?triggerError=${encodeURIComponent(triggerError)}`;
  return done ? `/workflows?done=${encodeURIComponent(done)}` : "/workflows";
}

/** `/workflows` carrying a failure the list itself will render as an alert. */
function workflowsError(message: string) {
  return `/workflows?error=${encodeURIComponent(message)}`;
}

/*
 * Both writers follow the same shape: everything that can fail sits inside the
 * try, and the redirect is outside it — `redirect()` works by throwing, so a
 * try/catch wrapped around it would swallow the navigation and report the
 * successful save as an error.
 */
export async function createWorkflow(
  _prev: WorkflowFormState,
  formData: FormData,
): Promise<WorkflowFormState> {
  let triggerError: string | null = null;
  let notice = "Workflow created.";

  try {
    const user = await requireUser();
    await assertWorkflowQuota(user.id);

    const { warnings, ...parsed } = await parseWorkflowForm(formData, user.id);
    const slug = await uniqueSlug(user.id, parsed.name);

    // Stamped at creation because a scheduled run has no session to ask: the
    // row itself is the only statement of who this workflow belongs to, and
    // it selects both the provider key and the connections the run uses.
    await db.insert(workflows).values({ ...parsed, slug, userId: user.id });
    triggerError = await registerTriggers(user.id);
    if (warnings.length > 0) notice = `Workflow created. ${warnings.join(" ")}`;
  } catch (err) {
    return actionError(err, formData);
  }

  revalidatePath("/workflows");
  redirect(workflowsPath(triggerError, notice));
}

/**
 * Caps how much one account can own. Signup is open, so without this a single
 * user can fill the scheduler with workflows and crowd everyone else out of
 * the tick budget.
 */
async function assertWorkflowQuota(userId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflows)
    .where(eq(workflows.userId, userId));

  if ((row?.count ?? 0) >= LIMITS.maxWorkflowsPerUser) {
    throw new Error(
      `You've reached the limit of ${LIMITS.maxWorkflowsPerUser} workflows. ` +
        `Delete one to make room.`,
    );
  }
}

/** Same, for the subset that is actually scheduled. */
async function enabledWorkflowCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflows)
    .where(and(eq(workflows.userId, userId), eq(workflows.enabled, true)));
  return row?.count ?? 0;
}

export async function updateWorkflow(
  id: string,
  _prev: WorkflowFormState,
  formData: FormData,
): Promise<WorkflowFormState> {
  let triggerError: string | null = null;
  let notice = "Changes saved.";

  try {
    const user = await requireUser();
    const { warnings, ...parsed } = await parseWorkflowForm(
      formData,
      user.id,
      id,
    );
    // The name may have changed, so the slug is re-derived — excluding this
    // row, or renaming a workflow to its own name would bump it to "-2".
    const slug = await uniqueSlug(user.id, parsed.name, id);

    const updated = await db
      .update(workflows)
      .set({ ...parsed, slug, updatedAt: new Date() })
      // Ownership lives in the WHERE, not in a check before it: one statement,
      // no window between the check and the write, and no second place to
      // forget the scope.
      .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
      .returning({ id: workflows.id });

    // Deleted in another tab while this form sat open — or never theirs to
    // begin with. Both get the same answer, which is the point.
    if (updated.length === 0) {
      return {
        error: "This workflow no longer exists — it may have been deleted.",
        values: formValues(formData),
      };
    }

    triggerError = await registerTriggers(user.id);
    if (warnings.length > 0) notice = `Changes saved. ${warnings.join(" ")}`;
  } catch (err) {
    return actionError(err, formData);
  }

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
  redirect(workflowsPath(triggerError, notice));
}

export async function toggleWorkflow(id: string, enabled: boolean) {
  let failure: string | null = null;
  try {
    const user = await requireUser();

    if (
      enabled &&
      (await enabledWorkflowCount(user.id)) >= LIMITS.maxEnabledPerUser
    ) {
      throw new Error(
        `You already have ${LIMITS.maxEnabledPerUser} workflows scheduled. ` +
          `Pause one before enabling another.`,
      );
    }

    const changed = await db
      .update(workflows)
      .set({
        enabled,
        // Enabling by hand clears an automatic pause: whatever the app
        // decided earlier, the user has now said otherwise.
        pausedReason: null,
        ...(enabled ? { connectionFailures: 0 } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
      .returning({ id: workflows.id });

    if (changed.length === 0) {
      failure = "That workflow no longer exists.";
    } else {
      // Pausing the last workflow using a trigger slug should deregister it at
      // Composio, and enabling one should register it again.
      await registerTriggers(user.id);
    }
  } catch (err) {
    failure = actionError(err).error;
  }

  revalidatePath("/workflows");
  // These buttons live on the list itself, so the message goes back to the
  // list rather than through the error boundary — the row the user clicked is
  // still on screen next to the explanation.
  redirect(
    failure
      ? workflowsError(failure)
      : workflowsPath(null, enabled ? "Schedule enabled." : "Schedule paused."),
  );
}

/**
 * Pauses any chained workflow left pointing at nothing.
 *
 * The parent foreign key is ON DELETE SET NULL, which keeps a child's run
 * history rather than cascading it away — but leaves the child with a trigger
 * that can never fire. Paused is the honest state, and `pausedReason` lets the
 * workflows page say why instead of showing a workflow that looks scheduled
 * and never runs.
 */
async function pauseOrphanedChildren(userId: string): Promise<void> {
  await db
    .update(workflows)
    .set({ enabled: false, pausedReason: "parent_deleted" })
    .where(
      and(
        eq(workflows.userId, userId),
        eq(workflows.triggerType, "workflow"),
        isNull(workflows.parentWorkflowId),
        eq(workflows.enabled, true),
      ),
    );
}

export async function deleteWorkflow(id: string) {
  let failure: string | null = null;
  try {
    const user = await requireUser();
    const deleted = await db
      .delete(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
      .returning({ id: workflows.id });

    // Previously this reported success for a delete that matched nothing.
    if (deleted.length === 0) {
      failure = "That workflow no longer exists.";
    } else {
      // Deleting the last workflow using a trigger slug must deregister it —
      // otherwise Composio keeps delivering events that now match nothing.
      await registerTriggers(user.id);
      await pauseOrphanedChildren(user.id);
    }
  } catch (err) {
    failure = actionError(err).error;
  }

  revalidatePath("/workflows");
  redirect(
    failure
      ? workflowsError(failure)
      : workflowsPath(null, "Workflow deleted."),
  );
}

/**
 * Disconnects a toolkit for the signed-in user.
 *
 * Keyed by toolkit slug, not by Composio account id. The previous signature
 * took an id straight from the client and deleted whatever it named — safe
 * only while the app had exactly one user, and a "delete anyone's Slack
 * connection" button the moment it had two. Resolving the account from
 * (user, toolkit) server-side means the ownership check *is* the lookup.
 */
export async function disconnectToolkit(toolkit: string) {
  const user = await requireUser();

  const conn = await getUserConnection(user.id, toolkit);
  if (!conn) {
    revalidatePath("/connections");
    redirect(
      `/connections?error=${encodeURIComponent("That connection no longer exists.")}`,
    );
  }

  const label = TOOLKIT_LABELS[toolkit] ?? toolkit;
  const dependents = await workflowsUsingToolkit(user.id, toolkit);

  try {
    const accountIds = [
      conn.connectedAccountId,
      conn.pendingAccountId,
      ...conn.staleAccountIds,
    ].filter((id): id is string => Boolean(id));

    for (const accountId of accountIds) {
      await deleteConnectedAccount(accountId);
    }
  } catch (err) {
    /*
     * A Composio failure here — most commonly a 403 because the API key only
     * has read access to `connected_accounts` — used to bubble out of the
     * action and replace the whole page with Next's generic "This page
     * couldn't load". The message is the only thing that tells the user what
     * to fix, so it rides back on the URL and renders as an alert.
     */
    revalidatePath("/connections");
    redirect(
      `/connections?error=${encodeURIComponent(composioErrorMessage(err))}`,
    );
  }

  await markDisconnected(user.id, toolkit);

  /*
   * Workflows that needed this toolkit are paused rather than deleted, and
   * marked with *why* — so reconnecting can re-enable exactly these, and not
   * the ones the user paused deliberately.
   */
  if (dependents.length > 0) {
    await db
      .update(workflows)
      .set({
        enabled: false,
        pausedReason: "needs_reconnect",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflows.userId, user.id),
          inArray(
            workflows.id,
            dependents.map((w) => w.id),
          ),
        ),
      );
  }

  // Triggers bound to the account we just deleted are now dead weight.
  await syncEventTriggers(user.id).catch((err) =>
    console.error("[triggers] sync after disconnect failed", err),
  );

  revalidatePath("/connections");
  revalidatePath("/workflows");

  const message =
    dependents.length > 0
      ? `${label} disconnected. ${dependents.length} workflow${
          dependents.length === 1 ? "" : "s"
        } paused: ${dependents.map((w) => w.name).join(", ")}.`
      : `${label} disconnected.`;

  redirect(`/connections?done=${encodeURIComponent(message)}`);
}

/**
 * Queues a manual run and hands the user straight to its live page. The run
 * itself continues in `after()`, so the button doesn't stay pending for the
 * minutes an agent run can take.
 */
export async function runWorkflowNow(id: string) {
  // Resolved inside the try, acted on after it — `redirect()` throws, so it
  // cannot be called from inside a block that catches.
  let destination: string;

  try {
    const user = await requireUser();
    const workflow = await ownedWorkflow(id, user.id);

    // Deleted since the page rendered — or someone else's. Throwing here
    // reached the user as an error screen; the list plus a sentence is the
    // honest answer, and it's the same answer in both cases by design.
    if (!workflow) {
      redirect(workflowsError("That workflow no longer exists."));
    }

    const queued = await enqueueRun(id, "manual");

    if (queued.skipped) {
      // Already in flight — starting a second concurrent run of the same
      // workflow is exactly what the one-active-run index exists to prevent,
      // so say that rather than appearing to do nothing.
      revalidatePath("/runs");
      destination =
        queued.reason === "already_running"
          ? "/runs?notice=" +
            encodeURIComponent(
              "That workflow is already running — showing the run in progress.",
            )
          : "/runs";
    } else {
      const runId = queued.runId;
      after(() => executeRun(runId));
      revalidatePath("/runs");
      revalidatePath("/");
      destination = `/runs/${runId}`;
    }
  } catch (err) {
    // `actionError` re-throws the redirect signals raised above (and by
    // `requireUser`), so only real failures land here.
    destination = workflowsError(actionError(err).error!);
  }

  redirect(destination);
}
