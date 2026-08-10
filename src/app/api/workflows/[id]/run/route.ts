import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";

export const maxDuration = 300;

// "Run now" button in the dashboard.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!workflow) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }

  const result = await runWorkflow(workflow, "manual");
  return NextResponse.json(result);
}
