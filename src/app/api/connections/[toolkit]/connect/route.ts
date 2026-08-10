import { NextRequest, NextResponse } from "next/server";
import { initiateConnection, TOOLKITS } from "@/lib/composio";

// GET so a plain <a href> / form-less button click can hit it directly and
// follow the redirect — no client JS needed for the core flow.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> }
) {
  const { toolkit } = await params;

  if (!TOOLKITS.includes(toolkit as (typeof TOOLKITS)[number])) {
    return NextResponse.json({ error: `Unknown toolkit: ${toolkit}` }, { status: 400 });
  }

  const callbackUrl = new URL("/connections", req.url).toString();

  try {
    const { redirectUrl } = await initiateConnection(toolkit, callbackUrl);
    if (!redirectUrl) {
      return NextResponse.json(
        { error: `Composio did not return a redirect URL for ${toolkit}` },
        { status: 502 }
      );
    }
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
