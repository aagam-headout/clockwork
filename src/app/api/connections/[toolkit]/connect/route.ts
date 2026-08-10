import { NextRequest, NextResponse } from "next/server";
import { initiateConnection, toolkitExists } from "@/lib/composio";
import { auth } from "@/lib/auth/server";

// GET so a plain <a href> / form-less button click can hit it directly and
// follow the redirect — no client JS needed for the core flow.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> },
) {
  // Belt-and-suspenders: middleware already blocks unauthenticated
  // requests, but this only exists to be linked from the (already
  // owner-gated) /connections page — reject anyone else outright.
  const { data: session } = await auth.getSession();
  if (session?.user?.email !== process.env.OWNER_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { toolkit } = await params;

  // Any Composio toolkit is connectable, not just a curated few — so the slug
  // is only shape-checked here and then verified against the live catalog.
  if (!/^[a-z0-9_]{2,64}$/.test(toolkit)) {
    return NextResponse.json(
      { error: `Malformed toolkit slug: ${toolkit}` },
      { status: 400 },
    );
  }

  if (!(await toolkitExists(toolkit))) {
    return NextResponse.json(
      { error: `Unknown toolkit: ${toolkit}` },
      { status: 400 },
    );
  }

  const callbackUrl = new URL("/connections", req.url).toString();

  try {
    const { redirectUrl } = await initiateConnection(toolkit, callbackUrl);
    if (!redirectUrl) {
      return NextResponse.json(
        { error: `Composio did not return a redirect URL for ${toolkit}` },
        { status: 502 },
      );
    }
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
