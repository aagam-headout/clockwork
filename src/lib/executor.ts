import { generateText, stepCountIs, type ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, runSteps, outputs, workflows } from "@/db/schema";
import { composio, COMPOSIO_USER_ID } from "@/lib/composio";
import {
  buildToolFilter,
  DELIVER_TOOL_SLUGS,
  type DeliverTarget,
} from "@/lib/read-only";

type Workflow = typeof workflows.$inferSelect;

const SYSTEM_PROMPT = `You are a personal automation agent running an unattended, scheduled workflow.

Rules:
- You are READ-ONLY. Only the tools you've been given exist for you — there is
  no other way to take action, so never claim to have sent, created, or
  changed anything unless you actually called a tool that did it.
- Be concise. Your final answer is a short markdown digest a human will
  skim on a phone: headline first, then a tight bulleted list. No preamble,
  no "here is a summary of...".
- If a tool call fails or returns nothing, say so plainly in one line rather
  than guessing or inventing content.`;

export async function runWorkflow(
  workflow: Workflow,
  trigger: "cron" | "manual",
) {
  const [run] = await db
    .insert(runs)
    .values({
      workflowId: workflow.id,
      trigger,
      status: "running",
      startedAt: new Date(),
    })
    .returning();

  const startedAt = Date.now();
  let stepIdx = 0;

  const recordStep = async (
    row: Omit<
      typeof runSteps.$inferInsert,
      "id" | "runId" | "idx" | "createdAt"
    >,
  ) => {
    await db.insert(runSteps).values({ runId: run.id, idx: stepIdx++, ...row });
  };

  try {
    const deliver = (workflow.deliver as DeliverTarget[]) ?? [];
    const deliverToolkits = deliver.some((d) => d.type === "slack_dm")
      ? ["slack"]
      : [];
    const toolkits = Array.from(
      new Set([...workflow.toolkits, ...deliverToolkits]),
    );

    const allTools = (await composio.tools.get(COMPOSIO_USER_ID, {
      toolkits,
    })) as ToolSet;

    const isAllowed = buildToolFilter(deliver);
    const tools: ToolSet = Object.fromEntries(
      Object.entries(allTools).filter(([slug]) => isAllowed(slug)),
    );

    const deliverInstructions = deliver
      .map((d) =>
        d.type === "slack_dm"
          ? `- Also send your final digest via ${DELIVER_TOOL_SLUGS.slack_dm} as a Slack DM to the user.`
          : null,
      )
      .filter(Boolean)
      .join("\n");

    const result = await generateText({
      model: gateway(workflow.model),
      system: deliverInstructions
        ? `${SYSTEM_PROMPT}\n\n${deliverInstructions}`
        : SYSTEM_PROMPT,
      prompt: workflow.goal,
      tools,
      stopWhen: stepCountIs(workflow.maxSteps),
      onStepFinish: async (step) => {
        for (const call of step.toolCalls ?? []) {
          const matchingResult = step.toolResults?.find(
            (r) => r.toolCallId === call.toolCallId,
          );
          await recordStep({
            type: "tool",
            toolSlug: call.toolName,
            argsJson: call.input as object,
            resultJson: (matchingResult?.output as object) ?? null,
          });
        }
        if (step.text) {
          await recordStep({ type: "text", resultJson: { text: step.text } });
        }
      },
    });

    const deliveredTo = deliver
      .filter(
        (d) =>
          d.type === "dashboard" ||
          result.toolCalls.some(
            (c) => c.toolName === DELIVER_TOOL_SLUGS[d.type],
          ),
      )
      .map((d) => d.type);
    // "dashboard" delivers unconditionally by writing this row at all.
    if (!deliveredTo.includes("dashboard")) deliveredTo.push("dashboard");

    await db.insert(outputs).values({
      runId: run.id,
      format: "markdown",
      body: result.text,
      deliveredTo,
    });

    await db
      .update(runs)
      .set({
        status: "ok",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      })
      .where(eq(runs.id, run.id));

    await db
      .update(workflows)
      .set({ lastRunAt: new Date() })
      .where(eq(workflows.id, workflow.id));

    return { runId: run.id, status: "ok" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({
        status: "error",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        error: message,
      })
      .where(eq(runs.id, run.id));
    return { runId: run.id, status: "error" as const, error: message };
  }
}
