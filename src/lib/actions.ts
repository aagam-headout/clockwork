"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";
import type { DeliverTarget } from "@/lib/read-only";
import { requireOwner } from "@/lib/auth/require-owner";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseWorkflowForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const goal = String(formData.get("goal") ?? "").trim();
  const cron = String(formData.get("cron") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "Asia/Kolkata").trim();
  const model = String(formData.get("model") ?? "anthropic/claude-sonnet-5").trim();
  const maxSteps = Number(formData.get("maxSteps") ?? 15);
  const toolkits = formData.getAll("toolkits").map(String);

  const deliver: DeliverTarget[] = [{ type: "dashboard" }];
  if (formData.get("deliverSlack") === "on") deliver.push({ type: "slack_dm" });

  if (!name || !goal || !cron || toolkits.length === 0) {
    throw new Error("Name, goal, cron, and at least one toolkit are required.");
  }

  return { name, goal, cron, timezone, model, maxSteps, toolkits, deliver };
}

export async function createWorkflow(formData: FormData) {
  await requireOwner();
  const parsed = parseWorkflowForm(formData);
  const slug = slugify(parsed.name);

  await db.insert(workflows).values({ ...parsed, slug });

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

  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
  redirect("/workflows");
}

export async function toggleWorkflow(id: string, enabled: boolean) {
  await requireOwner();
  await db.update(workflows).set({ enabled, updatedAt: new Date() }).where(eq(workflows.id, id));
  revalidatePath("/workflows");
}

export async function deleteWorkflow(id: string) {
  await requireOwner();
  await db.delete(workflows).where(eq(workflows.id, id));
  revalidatePath("/workflows");
  redirect("/workflows");
}

export async function runWorkflowNow(id: string) {
  await requireOwner();
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!workflow) throw new Error("workflow not found");

  await runWorkflow(workflow, "manual");
  revalidatePath("/runs");
  revalidatePath("/");
}
