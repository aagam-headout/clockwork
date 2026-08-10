import { NextRequest, NextResponse } from "next/server";
import { searchToolkits } from "@/lib/composio";
import { isOwner } from "@/lib/auth/require-owner";

// Backs the connector search on /connections. Owner-gated like everything
// else — the catalog itself isn't secret, but the Composio quota is.
export async function GET(req: NextRequest) {
  if (!(await isOwner())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";

  try {
    const items = await searchToolkits(query);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
