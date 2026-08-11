import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/user";
import { listTriggerTypes } from "@/lib/triggers";
import { composioErrorMessage } from "@/lib/composio";

/** Feeds the event-trigger picker in the workflow form. */
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const toolkits = (req.nextUrl.searchParams.get("toolkits") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    return NextResponse.json({ items: await listTriggerTypes(toolkits) });
  } catch (err) {
    // Composio being down here means the picker has nothing to offer; an
    // unhandled throw made that a 500 HTML page, which the form then failed to
    // parse as JSON. A stated reason is what lets it say why the list is empty.
    console.error("[trigger-types]", err);
    return NextResponse.json(
      { error: composioErrorMessage(err) },
      { status: 502 },
    );
  }
}
