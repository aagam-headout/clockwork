import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { TOOLKITS } from "@/lib/toolkits";

export const maxDuration = 60;

const AVAILABLE_TOOLKITS = [...TOOLKITS, "composio_search"] as const;
const AVAILABLE_MODELS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-haiku-4-5",
] as const;

const ProposalSchema = z.object({
  name: z.string().describe("short kebab-or-plain name, e.g. 'morning-brief'"),
  goal: z
    .string()
    .describe(
      "the full natural-language prompt the workflow's agent will run on every trigger — specific about what to check and how to summarize it"
    ),
  cron: z.string().describe("standard 5-field cron expression"),
  timezone: z.string().describe("IANA timezone, e.g. Asia/Kolkata"),
  toolkits: z.array(z.enum(AVAILABLE_TOOLKITS)).min(1),
  model: z.enum(AVAILABLE_MODELS),
  maxSteps: z.number().int().min(1).max(30),
  deliverSlack: z.boolean().describe("whether to also DM the digest on Slack"),
  rationale: z.string().describe("one or two sentences explaining the choices, shown to the user"),
});

const SYSTEM_PROMPT = `You turn a rough, plain-English description of a recurring personal task into
a structured workflow spec for a read-only automation agent.

Available toolkits (pick only what the goal actually needs): ${AVAILABLE_TOOLKITS.join(", ")}.
"composio_search" needs no auth and covers news/web search — use it for anything about
news, trends, or public information. The others require the user to have connected
that account already; still pick them if the goal needs them.

The agent that will run this workflow is READ-ONLY except that it may send itself a
Slack DM if deliverSlack is true. It cannot send email, create issues, post to
channels, or modify anything. Write the goal accordingly — do not ask it to take
actions it can't take.

Prefer claude-sonnet-5 unless the task is trivial (haiku) or clearly needs deep
reasoning across a lot of context (opus). Default timezone to Asia/Kolkata unless
the user implies otherwise. Keep maxSteps around 10-15 for a normal digest, higher
only if the goal spans many toolkits.`;

export async function POST(req: NextRequest) {
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { description } = await req.json();
  if (!description || typeof description !== "string") {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  try {
    const { object } = await generateObject({
      model: gateway("anthropic/claude-sonnet-5"),
      schema: ProposalSchema,
      system: SYSTEM_PROMPT,
      prompt: description,
    });
    return NextResponse.json(object);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
