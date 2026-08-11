import { NextRequest, NextResponse } from "next/server";
import { searchToolkits } from "@/lib/composio";
import { requireUserApi } from "@/lib/auth/user";
import { takeToken } from "@/lib/rate-limit";

// Backs the connector search on /connections. The catalog itself isn't secret,
// but it is fetched with the app-wide Composio key — so one account typing in
// the search box is spending everyone's quota, and it is rate limited.
export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const gate = await takeToken(auth.user.id, "toolkit_search");
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Searching too fast — slow down for a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) },
      },
    );
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
