import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";

/**
 * This app has exactly one legitimate user. Middleware (see middleware.ts)
 * already blocks anyone without a session; this closes the remaining gap —
 * a *different* signed-in account (anyone can sign up against the Neon Auth
 * API) still has zero access, because it isn't OWNER_EMAIL.
 *
 * Called at the top of every protected page and every mutating server
 * action — defense in depth, since actions can in principle be invoked
 * directly, not just through the buttons that trigger them.
 */
export async function requireOwner() {
  const { data: session } = await auth.getSession();
  const email = session?.user?.email;

  if (!email) redirect("/auth/sign-in");
  if (email !== process.env.OWNER_EMAIL) redirect("/auth/forbidden");

  return session;
}
