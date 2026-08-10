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
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0;
  const limit = 24;

  try {
    const items = await searchToolkits(query, limit, offset);
    // A full page back means there may be more — cheaper than a second
    // count query, and off by at most one "Load more" click at the tail.
    return NextResponse.json({ items, hasMore: items.length === limit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
