import { LIMITS } from "@/lib/limits";

/*
 * Chain shape validation, kept pure.
 *
 * The caller loads the owner's workflows and passes them in, so the cycle and
 * depth logic — the part that is easy to get wrong — is testable without a
 * database, and the query stays where the ownership scoping already lives. A
 * parent id belonging to someone else is simply absent from `nodes`, so it
 * reads as "not found" rather than as a permission error that would confirm
 * the row exists.
 */

export type ChainNode = {
  id: string;
  parentWorkflowId: string | null;
};

/**
 * 1 for a root, 2 for its child, and so on.
 *
 * Guards against a cycle in the stored data even though `validateChain`
 * prevents one being written: this walks rows, and a row can be edited by
 * hand. An infinite loop here would hang a request.
 */
export function chainDepth(id: string, nodes: ChainNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([id]);
  let depth = 1;
  let current = byId.get(id)?.parentWorkflowId ?? null;

  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    depth++;
    current = byId.get(current)?.parentWorkflowId ?? null;
  }

  return depth;
}

/**
 * Checks that pointing `candidateId` at `parentId` keeps the chain legal.
 *
 * `candidateId` is null when creating a workflow, which is why depth and
 * fan-out are computed from the parent rather than from the candidate.
 */
export function validateChain(
  candidateId: string | null,
  parentId: string | null,
  nodes: ChainNode[],
): { ok: true } | { ok: false; error: string } {
  if (!parentId) return { ok: true };

  if (candidateId && candidateId === parentId) {
    return { ok: false, error: "a workflow cannot trigger itself" };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(parentId)) {
    return { ok: false, error: "parent workflow not found" };
  }

  // Walk up from the proposed parent. Meeting the candidate closes a loop.
  if (candidateId) {
    const seen = new Set<string>();
    let current: string | null = parentId;
    while (current) {
      if (current === candidateId) {
        return {
          ok: false,
          error:
            "that would create a cycle — this workflow already runs before the one you picked",
        };
      }
      if (seen.has(current)) break;
      seen.add(current);
      current = byId.get(current)?.parentWorkflowId ?? null;
    }
  }

  const depth = chainDepth(parentId, nodes) + 1;
  if (depth > LIMITS.maxChainDepth) {
    return {
      ok: false,
      error: `chains may be at most ${LIMITS.maxChainDepth} deep; this would be ${depth}`,
    };
  }

  const siblings = nodes.filter(
    (n) => n.parentWorkflowId === parentId && n.id !== candidateId,
  ).length;
  if (siblings >= LIMITS.maxChildrenPerWorkflow) {
    return {
      ok: false,
      error: `a workflow may trigger at most ${LIMITS.maxChildrenPerWorkflow} children`,
    };
  }

  return { ok: true };
}
