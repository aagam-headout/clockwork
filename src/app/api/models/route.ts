import { NextResponse } from "next/server";
import { getModelCatalog } from "@/lib/models";
import { isOwner } from "@/lib/auth/require-owner";

// Backs the model picker's search. Owner-gated like the rest of the app.
export async function GET() {
  if (!(await isOwner())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await getModelCatalog();
  return NextResponse.json({ items });
}
