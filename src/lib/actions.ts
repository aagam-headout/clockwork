"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun, executeRun } from "@/lib/executor";
import { disconnectAccount } from "@/lib/composio";
import { syncEventTriggers } from "@/lib/triggers";
import type { DeliverTarget } from "@/lib/read-only";
import { requireOwner } from "@/lib/auth/require-owner";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
 * A trigger that failed to register simply never fires — the failure is
 * logged, and re-saving the workflow retries it.
 */
async function registerTriggers(eventTriggers: string[], triggerType: string) {
  if (triggerType !== "event" || eventTriggers.length === 0) return;
  try {
    const results = await syncEventTriggers(eventTriggers);
    for (const r of results.filter((r) => !r.ok)) {
      console.error(`[triggers] failed to register ${r.slug}: ${r.error}`);
    }
  } catch (err) {
    console.error("[triggers] registration failed", err);
  }
}

export async function createWorkflow(formData: FormData) {
  await requireOwner();
  const parsed = parseWorkflowForm(formData);
  const slug = slugify(parsed.name);

  await db.insert(workflows).values({ ...parsed, slug });
  await registerTriggers(parsed.eventTriggers, parsed.triggerType);

  revalidatePath("/workflows");
  redirect("/workflows");
}

export async function updateWorkflow(id: string, formData: FormData) {
  await requireOwner();
  const parsed = parseWorkflowForm(formData);

  await db
    .update(workflows)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(workflows.id, id));
  await registerTriggers(parsed.eventTriggers, parsed.triggerType);

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
  redirect("/workflows");
}

export async function toggleWorkflow(id: string, enabled: boolean) {
  await requireOwner();
  await db
    .update(workflows)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(workflows.id, id));
  revalidatePath("/workflows");
}

export async function deleteWorkflow(id: string) {
  await requireOwner();
  await db.delete(workflows).where(eq(workflows.id, id));
  revalidatePath("/workflows");
  redirect("/workflows");
}

export async function disconnectToolkit(connectedAccountId: string) {
  await requireOwner();
  await disconnectAccount(connectedAccountId);
  revalidatePath("/connections");
}

/**
 * Queues a manual run and hands the user straight to its live page. The run
 * itself continues in `after()`, so the button doesn't stay pending for the
 * minutes an agent run can take.
 */
export async function runWorkflowNow(id: string) {
  await requireOwner();
  const [workflow] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!workflow) throw new Error("workflow not found");

  const queued = await enqueueRun(id, "manual");

  if (queued.skipped) {
    // Already in flight — send the user to the run list rather than
    // starting a second, concurrent run of the same workflow.
    revalidatePath("/runs");
    redirect("/runs");
  }

  const runId = queued.runId;
  after(() => executeRun(runId));

  revalidatePath("/runs");
  revalidatePath("/");
  redirect(`/runs/${runId}`);
}
