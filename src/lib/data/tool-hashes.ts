import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { runToolHashes } from "@/db/schema";

/**
 * sha256 of a value serialised with object keys recursively sorted, so two
 * calls that differ only in argument order hash the same. Array order is left
 * alone — in a tool call it carries meaning.
 */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalise(value)).digest("hex");
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

/*
 * Both of these swallow their errors, against the project's fail-loud rule.
 *
 * The justification is narrow and worth stating: this table is a pure token
 * optimisation. Failing a user's 6am digest because a hash lookup timed out
 * would trade a real outcome for a saving. Every failure is logged.
 */
export async function readToolHash(
  workflowId: string,
  toolSlug: string,
  argsHash: string,
): Promise<{ resultHash: string; seenAt: Date } | null> {
  try {
    const [row] = await db
      .select({
        resultHash: runToolHashes.resultHash,
        seenAt: runToolHashes.seenAt,
      })
      .from(runToolHashes)
      .where(
        and(
          eq(runToolHashes.workflowId, workflowId),
          eq(runToolHashes.toolSlug, toolSlug),
          eq(runToolHashes.argsHash, argsHash),
        ),
      )
      .limit(1);

    return row ?? null;
  } catch (err) {
    console.error("[tool-hashes] read failed", { toolSlug, err });
    return null;
  }
}

export async function writeToolHash(
  workflowId: string,
  toolSlug: string,
  argsHash: string,
  resultHash: string,
): Promise<void> {
  try {
    await db
      .insert(runToolHashes)
      .values({ workflowId, toolSlug, argsHash, resultHash })
      .onConflictDoUpdate({
        target: [
          runToolHashes.workflowId,
          runToolHashes.toolSlug,
          runToolHashes.argsHash,
        ],
        set: { resultHash, seenAt: new Date() },
      });
  } catch (err) {
    console.error("[tool-hashes] write failed", { toolSlug, err });
  }
}
