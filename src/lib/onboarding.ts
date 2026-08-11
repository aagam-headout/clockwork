import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { connections, workflows } from "@/db/schema";
import { hasAnyProviderKey } from "@/lib/provider-keys";

/**
 * What a new account still has to do before anything can actually run.
 *
 * Three cheap reads, all indexed. Deliberately not a wizard: a checklist that
 * dissolves as it completes lets someone look around first, which matters
 * because the API-key step is the one that surprises people and it lands better
 * once they've seen what the app is for.
 */
export type OnboardingState = {
  hasProviderKey: boolean;
  hasConnection: boolean;
  workflowCount: number;
  /** Every step done — the checklist stops rendering. */
  complete: boolean;
};

export async function getOnboardingState(
  userId: string,
): Promise<OnboardingState> {
  const [hasProviderKey, connectionRows, workflowRows] = await Promise.all([
    hasAnyProviderKey(userId),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(connections)
      .where(
        sql`${connections.userId} = ${userId} and ${connections.status} = 'active'`,
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflows)
      .where(eq(workflows.userId, userId)),
  ]);

  const hasConnection = (connectionRows[0]?.count ?? 0) > 0;
  const workflowCount = workflowRows[0]?.count ?? 0;

  return {
    hasProviderKey,
    hasConnection,
    workflowCount,
    complete: hasProviderKey && hasConnection && workflowCount > 0,
  };
}
