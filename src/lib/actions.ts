"use server";

import { eq, like, ne, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun, executeRun } from "@/lib/executor";
import { disconnectAccount } from "@/lib/composio";
import { syncEventTriggers } from "@/lib/triggers";
import type { DeliverTarget } from "@/lib/read-only";
import { currentUserEmail, requireOwner } from "@/lib/auth/require-owner";

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
 */
async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);

  const taken = new Set(
    (
      await db
        .select({ slug: workflows.slug })
        .from(workflows)
        .where(
          excludeId
            ? and(like(workflows.slug, `${base}%`), ne(workflows.id, excludeId))
            : like(workflows.slug, `${base}%`),
        )
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
 * `requireOwner()` redirects, so every catch in this file sits downstream of
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
function parseDeliver(formData: FormData): DeliverTarget[] {
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
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Webhook delivery needs an http(s) URL.");
    }
    deliver.push({ type: "webhook", url });
  }

  return deliver;
}

function parseWorkflowForm(formData: FormData) {
  const name = field(formData, "name");
  const goal = field(formData, "goal");
  const triggerType =
    field(formData, "triggerType", "cron") === "event" ? "event" : "cron";
  const cron = field(formData, "cron");
  const timezone = field(formData, "timezone", "Asia/Kolkata");
  const model = field(formData, "model", "anthropic/claude-sonnet-5");
  const maxSteps = Number(formData.get("maxSteps") ?? 15);
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

  const deliver = parseDeliver(formData);

  if (!name || !goal || toolkits.length === 0) {
    throw new Error("Name, goal, and at least one toolkit are required.");
  }
  if (triggerType === "cron" && !cron) {
    throw new Error("A scheduled workflow needs a cron expression.");
  }
  if (triggerType === "event" && eventTriggers.length === 0) {
    throw new Error("An event workflow needs at least one trigger.");
  }

  return {
    name,
    goal,
    triggerType,
    // An event workflow has no schedule; keep the column non-null and empty
    // so the dispatcher never considers it due.
    cron: triggerType === "event" ? "" : cron,
    timezone,
    model,
    maxSteps,
    readOnly,
    toolkits,
    eventTriggers,
    allowTools,
    denyTools,
    deliver,
  };
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
async function registerTriggers(
  eventTriggers: string[],
  triggerType: string,
): Promise<string | null> {
  if (triggerType !== "event" || eventTriggers.length === 0) return null;
  try {
    const results = await syncEventTriggers(eventTriggers);
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

  try {
    await requireOwner();
    const parsed = parseWorkflowForm(formData);
    const slug = await uniqueSlug(parsed.name);

    // Stamped at creation because a scheduled run has no session to ask: this
    // is what tells the executor whose provider the run goes through.
    const ownerEmail = await currentUserEmail();
    await db.insert(workflows).values({ ...parsed, slug, ownerEmail });
    triggerError = await registerTriggers(
      parsed.eventTriggers,
      parsed.triggerType,
    );
  } catch (err) {
    return actionError(err, formData);
  }

  revalidatePath("/workflows");
  redirect(workflowsPath(triggerError, "Workflow created."));
}

export async function updateWorkflow(
  id: string,
  _prev: WorkflowFormState,
  formData: FormData,
): Promise<WorkflowFormState> {
  let triggerError: string | null = null;

  try {
    await requireOwner();
    const parsed = parseWorkflowForm(formData);
    // The name may have changed, so the slug is re-derived — excluding this
    // row, or renaming a workflow to its own name would bump it to "-2".
    const slug = await uniqueSlug(parsed.name, id);

    const updated = await db
      .update(workflows)
      .set({ ...parsed, slug, updatedAt: new Date() })
      .where(eq(workflows.id, id))
      .returning({ id: workflows.id });

    // Deleted in another tab while this form sat open: the update matched no
    // rows, and without this the page redirected as if it had saved.
    if (updated.length === 0) {
      return {
        error: "This workflow no longer exists — it may have been deleted.",
        values: formValues(formData),
      };
    }

    triggerError = await registerTriggers(
      parsed.eventTriggers,
      parsed.triggerType,
    );
  } catch (err) {
    return actionError(err, formData);
  }

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
  redirect(workflowsPath(triggerError, "Changes saved."));
}

export async function toggleWorkflow(id: string, enabled: boolean) {
  let failure: string | null = null;
  try {
    await requireOwner();
    const changed = await db
      .update(workflows)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(workflows.id, id))
      .returning({ id: workflows.id });
    if (changed.length === 0) {
      failure = "That workflow no longer exists.";
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

export async function deleteWorkflow(id: string) {
  let failure: string | null = null;
  try {
    await requireOwner();
    await db.delete(workflows).where(eq(workflows.id, id));
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

export async function disconnectToolkit(connectedAccountId: string) {
  await requireOwner();
  try {
    await disconnectAccount(connectedAccountId);
  } catch (err) {
    /*
     * A Composio failure here — most commonly a 403 because the API key only
     * has read access to `connected_accounts` — used to bubble out of the
     * action and replace the whole page with Next's generic "This page
     * couldn't load". The message is the only thing that tells the user what
     * to fix, so it rides back on the URL and renders as an alert.
     */
    const message = err instanceof Error ? err.message : String(err);
    revalidatePath("/connections");
    redirect(`/connections?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/connections");
  redirect(`/connections?done=${encodeURIComponent("Disconnected.")}`);
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
    await requireOwner();
    const [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.id, id));

    // Deleted since the page rendered. Throwing here reached the user as an
    // error screen; the list plus a sentence is the honest answer.
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
    // `requireOwner`), so only real failures land here.
    destination = workflowsError(actionError(err).error!);
  }

  redirect(destination);
}
