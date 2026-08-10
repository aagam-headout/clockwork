import { NextRequest, NextResponse } from "next/server";
import { searchToolkits } from "@/lib/composio";
import { auth } from "@/lib/auth/server";

// Backs the connector search on /connections. Owner-gated like everything
// else — the catalog itself isn't secret, but the Composio quota is.
export async function GET(req: NextRequest) {
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";

  try {
    const items = await searchToolkits(query);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
