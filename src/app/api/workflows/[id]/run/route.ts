import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { runWorkflow } from "@/lib/executor";
import { auth } from "@/lib/auth/server";

export const maxDuration = 300;

// "Run now" button in the dashboard.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!workflow) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }

  const result = await runWorkflow(workflow, "manual");
  return NextResponse.json(result);
}
