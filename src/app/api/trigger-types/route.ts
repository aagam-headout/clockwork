import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/auth/require-owner";
import { listTriggerTypes } from "@/lib/triggers";

/** Feeds the event-trigger picker in the workflow form. */
export async function GET(req: NextRequest) {
  if (!(await isOwner())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const toolkits = (req.nextUrl.searchParams.get("toolkits") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json({ items: await listTriggerTypes(toolkits) });
}
