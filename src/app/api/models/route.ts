import { NextResponse } from "next/server";
import { getModelCatalog } from "@/lib/models";
import { auth } from "@/lib/auth/server";

// Backs the model picker's search. Owner-gated like the rest of the app.
export async function GET() {
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await getModelCatalog();
  return NextResponse.json({ items });
}
