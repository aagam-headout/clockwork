import { NextRequest, NextResponse } from "next/server";
import { generateObject, generateText, stepCountIs, type ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { isOwner } from "@/lib/auth/require-owner";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalog } from "@/lib/models";
import { formatUsd, type ModelInfo } from "@/lib/model-tiers";
import {
  BUILDER_RESEARCH_STEPS,
  DEFAULT_BUILDER_MODEL,
  isBuilderModel,
} from "@/lib/builder-models";
import { composio, COMPOSIO_USER_ID } from "@/lib/composio";
import { buildToolFilter } from "@/lib/read-only";

// Two model calls now (research, then the spec), and the research one waits on
// real app APIs.
export const maxDuration = 120;

/** Research is capped hard: it exists to check facts, not to run the workflow. */
const RESEARCH_TIMEOUT_MS = 45_000;

/*
 * Optional first pass: let the assistant actually look inside the apps the user
 * pointed it at — read which Slack channels exist, what a calendar looks like,
 * how repos are named — so the goal it writes references real things instead of
 * plausible-sounding placeholders. Read-only, always: this is a form-filling
 * conversation, and nothing typed here should change state in a connected app.
 */
async function research(
  modelId: string,
  toolkits: string[],
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ notes: string; usedTools: string[] }> {
  const allTools = (await composio.tools.get(COMPOSIO_USER_ID, {
    toolkits,
  })) as ToolSet;

  const isAllowed = buildToolFilter([], [], [], true);
  const tools: ToolSet = Object.fromEntries(
    Object.entries(allTools).filter(([slug]) => isAllowed(slug)),
  );
  if (Object.keys(tools).length === 0) return { notes: "", usedTools: [] };

  const usedTools: string[] = [];
  const result = await generateText({
    model: gateway(modelId),
    tools,
    stopWhen: stepCountIs(BUILDER_RESEARCH_STEPS),
    abortSignal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
    onStepFinish: (step) => {
      for (const call of step.toolCalls ?? []) usedTools.push(call.toolName);
    },
    system: `You are helping design a recurring automation for this user. Look up whatever
would make the conversation concrete — channel names, calendar layout, repo or
label names, what their inbox actually looks like — so the next turn can name
real things, whether it asks a sharper question or writes the spec.

Make at most a few calls, and only where a real value beats a guess. Then reply
with terse notes: the specific names and ids you found, nothing else. If the
request needs no lookup, reply with "none".`,
    messages: history,
  });

  const notes = result.text.trim();
  return {
    notes: notes.toLowerCase() === "none" ? "" : notes,
    usedTools: [...new Set(usedTools)],
  };
}

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
    reply: z
      .string()
      .describe(
        "what to say to the user in the chat: either the questions you need answered, or a one-or-two-sentence plain-English readback of the spec you just wrote",
      ),
    spec: buildSpecSchema(toolkitSlugs, modelIds)
      .nullable()
      .describe(
        "the workflow spec — null while you are still clarifying, filled in once you have enough to commit",
      ),
  });
}

function buildSpecSchema(toolkitSlugs: string[], modelIds: string[]) {
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
  });
}

function systemPrompt(
  toolkitSlugs: string[],
  models: ModelInfo[],
  current: unknown,
  notes: string,
) {
  return `You are a colleague helping someone set up a recurring personal automation. You
talk it through first, and only write the spec once you both know what it should
do. The spec drives a read-only agent that will run unattended, so a wrong
assumption here quietly produces a useless digest every morning.

Every turn you return two things: "reply" — what you say in the chat — and
"spec" — the structured workflow, or null.

## Talk first (spec: null)

On a vague or underspecified request, leave spec null and ask. Rules for asking:
- Ask only what changes what the workflow DOES: which sources (which channel,
  calendar, repo, label, inbox), what counts as worth reporting, roughly when
  it should run, what a good digest looks like to them.
- Never ask about anything you can reasonably decide yourself: model, maxSteps,
  cron syntax, timezone. Decide those silently.
- At most 3 questions, in one message, as short bullets. Offer a concrete
  default for each ("I'd default to weekdays 8am — fine?") so they can answer
  with one word.
- Ask about real things you found in their apps, by name, when you know them.
- At most two rounds of questions. After that, commit to a spec with your best
  reading and say what you assumed.

## Commit (spec: filled in)

Write the spec as soon as any of these is true:
- They answered enough that the remaining choices are yours to make.
- Their first message was already specific (source + rough schedule + what they
  want out of it).
- They defer or approve: "you decide", "whatever's sensible", "go", "looks
  good", "yes", "do it".
- You have already asked twice.

When you commit, "reply" is a short plain-English readback: what it will do,
when, and any assumption you made — no field dump, the form beside the chat
already shows the values. End by inviting a tweak in a few words.

${
  current
    ? `The user is REFINING a spec you already proposed. Keep spec filled in from here
on — do not go back to asking — and return the COMPLETE spec every time,
carrying over everything they didn't ask you to change:
${JSON.stringify(current, null, 2)}

`
    : ""
}

${
  notes
    ? `You just looked inside the user's connected apps. These are real values —
prefer them over anything generic, and name them in the goal:
${notes}

`
    : ""
}## Filling the spec

The "goal" field is the prompt the runtime agent gets on every trigger, and it
sees nothing else — no chat history. Write it self-contained: which tools to
check, the named channels/repos/labels, what to include and what to skip, and
how to summarize. Fold in every decision you and the user reached.

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
  if (!(await isOwner())) {
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

    // The model the *builder itself* thinks with — separate from the model it
    // picks for the workflow. Two gates: it must be live in the gateway catalog
    // (so the body can't forward an arbitrary string to a provider) and
    // builder-capable (so a cheap model can't be forced in past the picker).
    const builderModel =
      typeof body.builderModel === "string" &&
      catalog.some((m) => m.id === body.builderModel) &&
      isBuilderModel(body.builderModel)
        ? body.builderModel
        : DEFAULT_BUILDER_MODEL;

    // Only toolkits the user ticked in the chat, intersected with what's
    // actually connected. `composio_search` is a toolkit like any other here.
    const readToolkits: string[] = Array.isArray(body.readToolkits)
      ? body.readToolkits.filter(
          (slug: unknown) =>
            typeof slug === "string" && toolkitSlugs.includes(slug),
        )
      : [];

    // Research is best-effort: a flaky app API should downgrade the proposal to
    // a guess, not fail the whole request.
    let notes = "";
    let usedTools: string[] = [];
    if (readToolkits.length > 0) {
      try {
        ({ notes, usedTools } = await research(
          builderModel,
          readToolkits,
          history,
        ));
      } catch {
        // Fall through with no notes.
      }
    }

    const { object } = await generateObject({
      model: gateway(builderModel),
      schema: buildProposalSchema(toolkitSlugs, modelIds),
      system: systemPrompt(toolkitSlugs, offered, body.current, notes),
      messages: history,
    });

    // Still clarifying: a chat turn with nothing to write into the form.
    if (!object.spec) {
      return NextResponse.json({ reply: object.reply, spec: null, usedTools });
    }

    // The model can still hallucinate a slug despite the prompt; drop anything
    // that isn't connected rather than proposing a workflow that can't run.
    const toolkits = object.spec.toolkits.filter((slug) =>
      toolkitSlugs.includes(slug),
    );
    const model = catalog.some((m) => m.id === object.spec!.model)
      ? object.spec.model
      : DEFAULT_MODEL;

    return NextResponse.json({
      reply: object.reply,
      spec: {
        ...object.spec,
        model,
        toolkits: toolkits.length > 0 ? toolkits : ["composio_search"],
      },
      // Shown in the chat so the user can see the proposal was grounded in a
      // real lookup rather than invented.
      usedTools,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
