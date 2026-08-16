import { NextRequest, NextResponse } from "next/server";
import { generateObject, generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth/user";
import { getConnectedToolkitOptions } from "@/lib/connected-toolkits";
import { getModelCatalogForUser } from "@/lib/models";
import { resolveModelForUser } from "@/lib/provider";
import { formatUsd, type ModelInfo } from "@/lib/model-tiers";
import {
  BUILDER_RESEARCH_STEPS,
  defaultBuilderModel,
  isBuilderModel,
} from "@/lib/builder-models";
import { getToolsFor } from "@/lib/composio";
import { takeToken } from "@/lib/rate-limit";
import { buildToolFilter } from "@/lib/read-only";
import { LIMITS } from "@/lib/limits";
import { parseCondition } from "@/lib/outcome/condition";
import { parseSignalSchema } from "@/lib/outcome/envelope";

// Two model calls: research, then the spec — research waits on real app
// APIs.
export const maxDuration = 120;

/** Research is capped hard: it exists to check facts, not to run the workflow. */
const RESEARCH_TIMEOUT_MS = 45_000;

/*
 * Optional first pass: let the assistant look inside the apps the user pointed
 * it at — which Slack channels exist, what a calendar looks like, how repos
 * are named — so the goal references real things instead of plausible-sounding
 * placeholders. Always read-only: this is a form-filling conversation, and
 * nothing typed here should change state in a connected app.
 */
async function research(
  userId: string,
  modelId: string,
  toolkits: string[],
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ notes: string; usedTools: string[] }> {
  const allTools = await getToolsFor(userId, toolkits);

  const isAllowed = buildToolFilter([], [], [], true);
  const tools: ToolSet = Object.fromEntries(
    Object.entries(allTools).filter(([slug]) => isAllowed(slug)),
  );
  if (Object.keys(tools).length === 0) return { notes: "", usedTools: [] };

  const usedTools: string[] = [];
  const result = await generateText({
    model: await resolveModelForUser(userId, modelId),
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

/*
 * Where a hallucinated model id lands. Read from the offered list, not
 * hardcoded, so it stays routable under whichever provider is active.
 */
function fallbackWorkflowModel(offered: ModelInfo[]): string {
  return (
    offered.find((m) => m.tier === "mid")?.id ??
    offered[0]?.id ??
    "anthropic/claude-sonnet-5"
  );
}

/**
 * The gateway lists hundreds of models — too many for a prompt. Offer the
 * cheapest handful of light and mid models (plus one heavy) with per-1M cost,
 * so the agent can trade cost against capability itself.
 */
function modelChoices(catalog: ModelInfo[]) {
  const pick = (tier: ModelInfo["tier"], n: number) =>
    catalog.filter((m) => m.tier === tier).slice(0, n);
  return [...pick("light", 6), ...pick("mid", 6), ...pick("heavy", 2)];
}

/*
 * The toolkit list is whatever's connected right now — any linked Composio
 * app, not a fixed set — so schema and prompt build per request, not at
 * module load.
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
    signalSchema: z
      .array(
        z.object({
          key: z
            .string()
            .describe("lowercase_with_underscores, e.g. open_prs_stale"),
          type: z.enum(["number", "string", "boolean"]),
          description: z.string().optional(),
        }),
      )
      .max(LIMITS.maxSignalsPerWorkflow)
      .optional()
      .describe(
        "Measurable values this workflow reports every run. Propose these only when the goal contains a threshold, a count, or a comparison — a purely narrative digest needs none.",
      ),
    alertCondition: z
      .string()
      .optional()
      .describe(
        "An expression over the signal names above, e.g. 'open_prs_stale > 3 || mrr_delta_pct < -5'. Only comparisons and && || ! are allowed — no arithmetic, no function calls. Propose one only when the user asked to be told conditionally.",
      ),
  });
}

function systemPrompt(
  toolkitSlugs: string[],
  models: ModelInfo[],
  current: unknown,
  notes: string,
  allowWrites: boolean,
  brokenSlugs: string[] = [],
) {
  // Default audience is Asia/Kolkata, where UTC's date is wrong for almost
  // six hours a day.
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  return `Today's date is ${today}. Use it to resolve anything relative ("starting
next Monday", "every day this week") the user says — never guess a date from
your own training data.

You are a colleague helping someone set up a recurring personal automation. You
talk it through first, and only write the spec once you both know what it should
do. The spec drives an agent that will run unattended, so a wrong assumption
here quietly produces a useless digest every morning${
    allowWrites ? " — or a wrong action in a real app" : ""
  }.

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

On every run after the first, the agent is also shown its previous digest and
told to report only what changed. Write the goal so "new" is unambiguous —
name the field that marks something as new (created date, unread state, a
moving number) — otherwise every run re-reports the same items or, worse, goes
silent on real changes.

Available toolkits — these are the apps the user has actually connected, pick only
what the goal needs and never invent a slug that isn't listed:
${toolkitSlugs.filter((slug) => !brokenSlugs.includes(slug)).join(", ")}.
"composio_search" needs no auth and covers news/web search — use it for anything about
news, trends, or public information.
${
  brokenSlugs.length > 0
    ? `\nThese are connected but currently broken — the user needs to reconnect them
before anything can use them. Do NOT put them in the spec. Mention it in your
reply if the goal really wants one: ${brokenSlugs.join(", ")}.`
    : ""
}
Slack DM delivery (deliverSlack) requires "slack" to be in the available list
above. If it isn't, leave deliverSlack false and say why rather than proposing
a delivery that cannot happen.

If the user gave a specific URL (a page to track, an IPO/stock page, a status
page, anything that changes over time), say so explicitly in the goal and
state that the agent must fetch that URL fresh on every run rather than rely
on what it already knows about it — stale numbers from memory are the #1 way
these workflows go wrong.

${
  allowWrites
    ? `The user has switched WRITE TOOLS ON for this workflow: the agent may call any
tool the toolkits above expose, including ones that create, update, send, or
delete. Only ask it to write when the user actually asked for an action — a
digest stays a digest. When it does write, say in the goal exactly what it may
change and under what condition, and tell it to do nothing rather than guess:
an unattended run has nobody to confirm with. Say plainly in your reply which
writes it will perform.

Deleting is still off: tools that delete, remove, trash, purge, reset, or revoke
are blocked at the runtime gate no matter what the goal says, until the user
names that exact tool slug in the workflow's "Allow only" list. If they ask for
one, write the rest of the workflow and tell them the one line they need to add
there — never write a goal that assumes a delete will go through.`
    : `The agent that will run this workflow is READ-ONLY except that it may send itself a
Slack DM if deliverSlack is true. It cannot send email, create issues, post to
channels, or modify anything. Write the goal accordingly — do not ask it to take
actions it can't take.`
}

Models available, cheapest first (blended cost per 1M tokens):
${models.map((m) => `- ${m.id} [${m.tier}] ${formatUsd(m.blendedPerM)}/1M`).join("\n")}

Pick the cheapest model that can do the job: a light model for a plain digest of
one or two sources, a mid model when it must reason over several tools, a heavy
model only for genuinely hard synthesis. A workflow that runs hourly should
almost always be light.

Default timezone to Asia/Kolkata unless the user implies otherwise. maxSteps is
the run's hard tool-call budget: about 10-15 covers a normal digest, higher only
if the goal spans many toolkits, and leave one extra step for the Slack DM when
deliverSlack is true — a run that hits the cap is recorded as truncated.

## Signals and alert conditions

Most workflows need neither. Leave both out for anything whose answer is a
narrative — "what happened in my inbox", "summarise yesterday's commits".

Propose signalSchema when the goal names something countable or comparable
that the run will measure every time: a count, a percentage, an age in days, a
yes/no state. Name them lowercase_with_underscores and describe each one.

Propose alertCondition only when the user asked to hear about it
conditionally — "only tell me if", "let me know when it goes above", "ping me
if nothing has moved in three days". Write it over the signal names you just
declared, using comparisons and && || ! and nothing else. Without a condition
the digest is delivered every run, which is the right default.

Say in your reply what the condition means in plain English, because a
threshold the user did not intend is a workflow that stays silent for weeks.`;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  /*
   * The most expensive endpoint in the app: two model calls plus a round of
   * live tool calls per request. Model spend is the user's own; tool calls
   * run on the shared Composio key.
   */
  const gate = await takeToken(user.id, "propose");
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          "You've used up this hour's builder requests. Try again shortly.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) },
      },
    );
  }

  // The builder is a conversation: the client sends the full turn history plus
  // the form's current spec, so "make it hourly" refines instead of starting
  // over. `description` stays accepted for a single-shot request.
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
    // The builder runs on the signed-in user's provider, same as the picker
    // beside the chat — otherwise it could offer models it can't use.
    const [connected, catalog] = await Promise.all([
      getConnectedToolkitOptions(user.id),
      getModelCatalogForUser(user.id),
    ]);

    // Everything the user has a connection row for, including broken ones —
    // the prompt names those separately so the assistant can mention them
    // instead of silently planning around their absence.
    const toolkitSlugs = ["composio_search", ...connected.map((t) => t.slug)];
    const usableSlugs = new Set([
      "composio_search",
      ...connected.filter((t) => t.usable !== false).map((t) => t.slug),
    ]);
    const brokenSlugs = connected
      .filter((t) => t.usable === false)
      .map((t) => t.slug);
    const offered = modelChoices(catalog);
    const modelIds = offered.map((m) => m.id);

    // The model the *builder itself* thinks with — separate from the model it
    // picks for the workflow. Two gates: must be live in the gateway catalog
    // (so the body can't forward an arbitrary string to a provider) and
    // builder-capable (so a cheap model can't be forced past the picker).
    const builderModel =
      typeof body.builderModel === "string" &&
      catalog.some((m) => m.id === body.builderModel) &&
      isBuilderModel(body.builderModel)
        ? body.builderModel
        : defaultBuilderModel(catalog);

    // Only toolkits the user ticked in the chat, intersected with what's
    // actually connected. `composio_search` is a toolkit like any other here.
    const readToolkits: string[] = Array.isArray(body.readToolkits)
      ? body.readToolkits.filter(
          (slug: unknown) =>
            typeof slug === "string" && toolkitSlugs.includes(slug),
        )
      : [];

    // The chat's own toggle, not the model's decision: letting a proposal
    // grant itself write access would put the safety default behind a
    // sentence of prose. Drafting stays read-only regardless (see
    // `research`); this only describes what the *saved workflow* may do.
    const allowWrites = body.allowWrites === true;

    // Research is best-effort: a flaky app API downgrades the proposal to a
    // guess, not the whole request.
    let notes = "";
    let usedTools: string[] = [];
    if (readToolkits.length > 0) {
      try {
        ({ notes, usedTools } = await research(
          user.id,
          builderModel,
          readToolkits,
          history,
        ));
      } catch {
        // Fall through with no notes.
      }
    }

    const { object } = await generateObject({
      model: await resolveModelForUser(user.id, builderModel),
      schema: buildProposalSchema(toolkitSlugs, modelIds),
      system: systemPrompt(
        toolkitSlugs,
        offered,
        body.current,
        notes,
        allowWrites,
        brokenSlugs,
      ),
      messages: history,
    });

    // Still clarifying: a chat turn with nothing to write into the form.
    if (!object.spec) {
      return NextResponse.json({ reply: object.reply, spec: null, usedTools });
    }

    // The model can still hallucinate a slug despite the prompt; drop
    // anything not *usable* rather than propose a workflow that can't run.
    // Stricter than what the prompt saw — a broken connection is fine to
    // talk about, not fine to build on.
    const toolkits = object.spec.toolkits.filter((slug) =>
      usableSlugs.has(slug),
    );

    // Delivery was never validated: the assistant could set `deliverSlack`
    // with no Slack connected, and the saved workflow would fail its first
    // delivery with no warning.
    const deliverSlack = object.spec.deliverSlack && usableSlugs.has("slack");
    const model = catalog.some((m) => m.id === object.spec!.model)
      ? object.spec.model
      : fallbackWorkflowModel(offered);

    /*
     * A proposed condition the form would reject is worse than none: the user
     * accepts the chat's suggestion, then hits a validation error they didn't
     * write. Signals are kept either way — a workflow measuring things
     * without a threshold is still useful, and the user can add one
     * themselves.
     */
    const signalSchema = parseSignalSchema(object.spec.signalSchema ?? []);
    const proposedCondition = object.spec.alertCondition?.trim();
    const alertCondition =
      proposedCondition && parseCondition(proposedCondition, signalSchema).ok
        ? proposedCondition
        : undefined;

    return NextResponse.json({
      reply: object.reply,
      spec: {
        ...object.spec,
        model,
        deliverSlack,
        signalSchema,
        alertCondition,
        toolkits: toolkits.length > 0 ? toolkits : ["composio_search"],
        // The form field is the flag's inverse; ship it so the prefilled
        // form shows the same permission the chat drafted under.
        readOnly: !allowWrites,
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
