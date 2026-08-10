import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalog } from "@/lib/models";
import { formatUsd, type ModelInfo } from "@/lib/model-tiers";

export const maxDuration = 60;

const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

/**
 * The gateway lists hundreds of models — too many to put in a prompt. Offer the
 * cheapest handful of light and mid models (plus one heavy option) with their
 * per-1M cost so the agent can trade cost against capability itself.
 */
function modelChoices(catalog: ModelInfo[]) {
  const pick = (tier: ModelInfo["tier"], n: number) =>
    catalog.filter((m) => m.tier === tier).slice(0, n);
  return [...pick("light", 6), ...pick("mid", 6), ...pick("heavy", 2)];
}

/*
 * The toolkit list is whatever is connected right now — any Composio app the
 * user has linked, not a fixed set — so the schema and prompt are built per
 * request instead of at module load.
 */
function buildProposalSchema(toolkitSlugs: string[], modelIds: string[]) {
  return z.object({
    name: z
      .string()
      .describe("short kebab-or-plain name, e.g. 'morning-brief'"),
    goal: z
      .string()
      .describe(
        "the full natural-language prompt the workflow's agent will run on every trigger — specific about what to check and how to summarize it",
      ),
    cron: z.string().describe("standard 5-field cron expression"),
    timezone: z.string().describe("IANA timezone, e.g. Asia/Kolkata"),
    toolkits: z
      .array(z.string())
      .min(1)
      .describe(`subset of: ${toolkitSlugs.join(", ")}`),
    model: z.string().describe(`one of: ${modelIds.join(", ")}`),
    maxSteps: z.number().int().min(1).max(30),
    deliverSlack: z
      .boolean()
      .describe("whether to also DM the digest on Slack"),
    rationale: z
      .string()
      .describe(
        "one or two sentences explaining the choices, shown to the user",
      ),
  });
}

function systemPrompt(
  toolkitSlugs: string[],
  models: ModelInfo[],
  current: unknown,
) {
  return `You turn a rough, plain-English description of a recurring personal task into
a structured workflow spec for a read-only automation agent.

${
  current
    ? `The user is REFINING a spec you already proposed. Return the complete spec every
time, carrying over everything they didn't ask you to change:
${JSON.stringify(current, null, 2)}

`
    : ""
}

Available toolkits — these are the apps the user has actually connected, pick only
what the goal needs and never invent a slug that isn't listed:
${toolkitSlugs.join(", ")}.
"composio_search" needs no auth and covers news/web search — use it for anything about
news, trends, or public information.

The agent that will run this workflow is READ-ONLY except that it may send itself a
Slack DM if deliverSlack is true. It cannot send email, create issues, post to
channels, or modify anything. Write the goal accordingly — do not ask it to take
actions it can't take.

Models available, cheapest first (blended cost per 1M tokens):
${models.map((m) => `- ${m.id} [${m.tier}] ${formatUsd(m.blendedPerM)}/1M`).join("\n")}

Pick the cheapest model that can do the job: a light model for a plain digest of
one or two sources, a mid model when it must reason over several tools, a heavy
model only for genuinely hard synthesis. A workflow that runs hourly should
almost always be light.

Default timezone to Asia/Kolkata unless the user implies otherwise. Keep maxSteps
around 10-15 for a normal digest, higher only if the goal spans many toolkits.`;
}

export async function POST(req: NextRequest) {
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // The builder is a conversation: the client sends the whole turn history plus
  // the spec currently in the form, so "make it hourly" refines instead of
  // starting over. `description` stays accepted for a single-shot request.
  const body = await req.json();
  const history: Array<{ role: "user" | "assistant"; content: string }> =
    Array.isArray(body.messages)
      ? body.messages
          .filter(
            (m: unknown): m is { role: string; content: string } =>
              typeof m === "object" &&
              m !== null &&
              typeof (m as { content?: unknown }).content === "string",
          )
          .map((m: { role: string; content: string }) => ({
            role:
              m.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            content: m.content,
          }))
      : typeof body.description === "string"
        ? [{ role: "user" as const, content: body.description }]
        : [];

  if (history.length === 0 || history.at(-1)?.role !== "user") {
    return NextResponse.json(
      { error: "a user message is required" },
      { status: 400 },
    );
  }

  try {
    const [connected, catalog] = await Promise.all([
      getConnectedToolkitOptions(),
      getModelCatalog(),
    ]);
    const toolkitSlugs = ["composio_search", ...connected.map((t) => t.slug)];
    const offered = modelChoices(catalog);
    const modelIds = offered.map((m) => m.id);

    const { object } = await generateObject({
      model: gateway(DEFAULT_MODEL),
      schema: buildProposalSchema(toolkitSlugs, modelIds),
      system: systemPrompt(toolkitSlugs, offered, body.current),
      messages: history,
    });

    // The model can still hallucinate a slug despite the prompt; drop anything
    // that isn't connected rather than proposing a workflow that can't run.
    const toolkits = object.toolkits.filter((slug) =>
      toolkitSlugs.includes(slug),
    );
    const model = catalog.some((m) => m.id === object.model)
      ? object.model
      : DEFAULT_MODEL;

    return NextResponse.json({
      ...object,
      model,
      toolkits: toolkits.length > 0 ? toolkits : ["composio_search"],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
