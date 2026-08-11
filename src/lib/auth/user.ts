import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { LOCAL_AUTH_BYPASS, LOCAL_OWNER_EMAIL } from "@/lib/auth/local";

/**
 * The signed-in user, as the rest of the app sees them.
 *
 * `id` is this app's own identity — a `users.id` uuid — and it is what every
 * owned row, and the per-user Composio namespace, key off. Neon Auth's user id
 * stays inside this module.
 */
export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "suspended";
  emailVerified: boolean;
};

type UserRow = typeof users.$inferSelect;

function toAppUser(row: UserRow, emailVerified: boolean): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status === "suspended" ? "suspended" : "active",
    emailVerified,
  };
}

/**
 * Auth ids this process has already ensured a row for.
 *
 * The point is to make the write in `ensureUser` happen once per user per
 * server instance rather than once per request. The *read* still happens every
 * time, so a suspension or an email change takes effect on the next navigation
 * instead of whenever an instance recycles.
 */
const ensured = new Set<string>();

/** Resolved once per process under `LOCAL_AUTH_BYPASS` — see `currentUser`. */
let localUser: AppUser | null = null;

/** Thrown-ish marker: the email is already claimed by a different auth account. */
class EmailTakenError extends Error {
  constructor() {
    super("email already claimed");
    this.name = "EmailTakenError";
  }
}

/**
 * Finds or creates the `users` row for an authenticated session.
 *
 * Three cases, in order, and the ordering is what makes the existing
 * single-user data survive:
 *
 *  1. Known auth id — the hot path, one indexed read.
 *  2. *Claim* an unclaimed row with this email. This is how the account the
 *     backfill seeded from OWNER_EMAIL adopts its workflows on the owner's
 *     first real sign-in. `auth_user_id IS NULL` in the WHERE makes the claim
 *     unstealable: once a row has an auth id, a second account with the same
 *     email cannot take it.
 *  3. Create.
 */
async function ensureUser(input: {
  authUserId: string | null;
  email: string;
  name: string | null;
  emailVerified: boolean;
}): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const { authUserId } = input;

  // 1. Known auth id.
  if (authUserId && ensured.has(authUserId)) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.authUserId, authUserId))
      .limit(1);
    if (row) return toAppUser(row, input.emailVerified);
    // The row was deleted under us; fall through and rebuild it.
    ensured.delete(authUserId);
  }

  // 2. Claim an unclaimed row (backfilled owner, or the local-bypass row).
  const [claimed] = await db
    .update(users)
    .set({
      authUserId,
      name: input.name,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`lower(${users.email}) = ${email}`,
        authUserId ? isNull(users.authUserId) : sql`true`,
      ),
    )
    .returning();

  if (claimed) {
    if (authUserId) ensured.add(authUserId);
    return toAppUser(claimed, input.emailVerified);
  }

  // 3. Create. The conflict target is the auth id, so two concurrent first
  //    requests — a page and the API call it fires — converge on one row.
  try {
    const [created] = await db
      .insert(users)
      .values({
        authUserId,
        email,
        name: input.name,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.authUserId,
        set: {
          email,
          name: input.name,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (authUserId) ensured.add(authUserId);
    return toAppUser(created, input.emailVerified);
  } catch (err) {
    /*
     * The functional unique index on lower(email) fired: a row with this email
     * exists and is claimed by a *different* auth account. Step 2 already tried
     * and failed to claim it, so this is genuinely a second signup for an
     * address someone else is signed in with — not something to silently merge.
     */
    if (isEmailUniqueViolation(err)) throw new EmailTakenError();
    throw err;
  }
}

function isEmailUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /users_email_unique/.test(message) || /duplicate key/.test(message);
}

/**
 * The signed-in user, or null.
 *
 * Memoized per request with React `cache()`, so a layout, its page and three
 * server components calling this cost one session read and one row read.
 *
 * The row upsert lives here rather than in a layout deliberately: route
 * handlers and server actions never run the layout, and those are exactly the
 * requests that need a `users.id` to scope by. Putting it here makes it
 * unskippable.
 */
export const currentUser = cache(async (): Promise<AppUser | null> => {
  if (LOCAL_AUTH_BYPASS) {
    /*
     * The bypass has no auth id, so it can't use the `ensured` fast path and
     * would otherwise write on every single request. The local user never
     * changes, so one lookup per process is enough.
     */
    if (!localUser) {
      localUser = await ensureUser({
        authUserId: null,
        email: LOCAL_OWNER_EMAIL,
        name: "Local",
        emailVerified: true,
      });
    }
    return localUser;
  }

  const { data: session } = await auth.getSession();
  const sessionUser = session?.user;
  if (!sessionUser?.email) return null;
  // Banned at the auth provider — the honest reading is "not signed in".
  if (sessionUser.banned) return null;

  try {
    return await ensureUser({
      authUserId: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name ?? null,
      emailVerified: Boolean(sessionUser.emailVerified),
    });
  } catch (err) {
    if (err instanceof EmailTakenError)
      redirect("/auth/forbidden?reason=email_taken");
    throw err;
  }
});

/**
 * For pages and server actions. Redirects rather than throwing, so an expired
 * session lands on the sign-in page instead of the error boundary.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) redirect("/auth/sign-in");
  if (user.status === "suspended") redirect("/auth/forbidden?reason=suspended");
  return user;
}

/**
 * For route handlers, which must answer with a status rather than navigate.
 *
 * ```ts
 * const auth = await requireUserApi();
 * if (!auth.ok) return auth.response;
 * // auth.user is an AppUser from here on
 * ```
 */
export async function requireUserApi(): Promise<
  { ok: true; user: AppUser } | { ok: false; response: NextResponse }
> {
  const user = await currentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not signed in — reload the page and sign in again." },
        { status: 401 },
      ),
    };
  }
  if (user.status === "suspended") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This account is suspended." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}
