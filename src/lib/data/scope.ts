import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { parseSignalSchema } from "@/lib/outcome/envelope";
import type { SignalDecl } from "@/lib/outcome/condition";

/*
 * Ownership, in one place.
 *
 * Two rules, and following them mechanically is the whole defence:
 *
 *   A. Reads of a specific id go through an accessor here — never a bare
 *      `db.select().where(eq(table.id, id))`.
 *   B. Mutations put the ownership check in the WHERE of the UPDATE/DELETE
 *      itself and check what came back. Never select-then-mutate: that is a
 *      TOCTOU window, and it is two separate chances to forget the scope.
 *
 * A non-owned id is always answered as *missing*, never as forbidden — see
 * `ownedWorkflowOr404`.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres raises a hard error casting a non-uuid string to uuid, which
 * reaches the browser as a 500 error page rather than a 404. With open signup
 * that is a free error-boundary DoS on every id-taking route, so a malformed
 * id is treated as "no such row" before it ever reaches the database.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Predicate for list queries: `where(ownedBy(user.id))`. */
export const ownedBy = (userId: string) => eq(workflows.userId, userId);

export async function ownedWorkflow(id: string, userId: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Page-level lookup.
 *
 * 404 and not 403, deliberately: a 403 confirms that the id exists, which
 * turns any guessed or leaked uuid into an oracle for "is this a real
 * workflow belonging to someone else". "Not found" is the same answer for a
 * deleted workflow and for someone else's, which is exactly right.
 */
export async function ownedWorkflowOr404(id: string, userId: string) {
  const row = await ownedWorkflow(id, userId);
  if (!row) notFound();
  return row;
}

export async function ownedRun(id: string, userId: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ run: runs, workflow: workflows })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(and(eq(runs.id, id), eq(workflows.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function ownedRunOr404(id: string, userId: string) {
  const row = await ownedRun(id, userId);
  if (!row) notFound();
  return row;
}

/**
 * Workflows this user could chain a new one behind.
 *
 * Scoped to the owner like everything else here, and it carries each
 * candidate's signals because the trigger condition is written against the
 * PARENT's signals — the picker has to be able to say which names are
 * available the moment a selection changes.
 *
 * `excludeId` drops the workflow being edited: a workflow cannot be its own
 * parent, and offering it would only produce a validation error on save.
 */
export async function chainParentOptions(
  userId: string,
  excludeId?: string,
): Promise<Array<{ id: string; name: string; signals: SignalDecl[] }>> {
  const scope = excludeId
    ? and(eq(workflows.userId, userId), ne(workflows.id, excludeId))
    : eq(workflows.userId, userId);

  const rows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      signalSchema: workflows.signalSchema,
    })
    .from(workflows)
    .where(scope)
    .orderBy(asc(workflows.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    signals: parseSignalSchema(row.signalSchema),
  }));
}

/**
 * The workflows either side of this one in a chain.
 *
 * Without this a chain is invisible from the page you are on: the child's form
 * names its parent, but nothing tells the parent what it triggers, so deleting
 * it looks free right up until three workflows pause.
 */
export async function chainNeighbours(
  userId: string,
  workflowId: string,
  parentWorkflowId: string | null,
): Promise<{
  parent: { id: string; name: string } | null;
  children: Array<{ id: string; name: string; enabled: boolean }>;
}> {
  const [parent, children] = await Promise.all([
    parentWorkflowId
      ? db
          .select({ id: workflows.id, name: workflows.name })
          .from(workflows)
          .where(
            and(
              eq(workflows.id, parentWorkflowId),
              eq(workflows.userId, userId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: workflows.id,
        name: workflows.name,
        enabled: workflows.enabled,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.userId, userId),
          eq(workflows.parentWorkflowId, workflowId),
        ),
      )
      .orderBy(asc(workflows.name)),
  ]);

  return { parent: parent[0] ?? null, children };
}
