import { evaluateCondition } from "./condition";
import type { SignalDecl } from "./condition";
import type { Envelope } from "./envelope";

/*
 * What a finished run causes: whether its digest is delivered, and which
 * downstream workflows it triggers.
 *
 * Pure, so the decision table is testable without a database. The executor
 * performs the resulting writes.
 */

export type DeliveryDecision = {
  deliver: boolean;
  suppressed: boolean;
  /**
   * Why, when there is a why. Also carries the two "delivered anyway" notes —
   * `condition_indeterminate` and `condition_error` — which are recorded
   * alongside a delivered digest rather than instead of one.
   */
  suppressedReason: string | null;
};

export function decideDelivery(
  envelope: Envelope,
  alertCondition: string | null,
  declared: SignalDecl[],
): DeliveryDecision {
  // Nothing to deliver, nothing to suppress: the agent looked and found
  // nothing — the design working, not a withheld alert.
  if (envelope.noUpdates) {
    return { deliver: false, suppressed: false, suppressedReason: null };
  }

  if (!alertCondition?.trim()) {
    return { deliver: true, suppressed: false, suppressedReason: null };
  }

  const result = evaluateCondition(alertCondition, declared, envelope.signals);

  /*
   * An unevaluable condition DELIVERS — the one deliberate asymmetry here.
   * If the threshold can't be checked (the agent didn't report the signal,
   * or the stored expression no longer parses against the current schema),
   * staying quiet is a silent failure of an alerting system, at 6am, with
   * nobody watching. The digest goes out and the reason is recorded, so the
   * run page can say the threshold didn't actually gate this delivery.
   */
  if (typeof result === "object") {
    return {
      deliver: true,
      suppressed: false,
      suppressedReason: `condition_error: ${result.error}`,
    };
  }

  if (result === "indeterminate") {
    return {
      deliver: true,
      suppressed: false,
      suppressedReason: "condition_indeterminate",
    };
  }

  if (result === "true") {
    return { deliver: true, suppressed: false, suppressedReason: null };
  }

  return {
    deliver: false,
    suppressed: true,
    suppressedReason: `alert condition not met: ${alertCondition.trim()}`,
  };
}

export function decideChildren<
  T extends { id: string; parentCondition: string | null },
>(
  envelope: Envelope,
  parentSignals: SignalDecl[],
  children: T[],
): { fire: T[]; skipped: Array<{ child: T; reason: string }> } {
  const fire: T[] = [];
  const skipped: Array<{ child: T; reason: string }> = [];

  for (const child of children) {
    // A parent that found nothing has nothing to hand down. Firing children
    // on an empty envelope would spend a model call each to rediscover that.
    if (envelope.noUpdates) {
      skipped.push({ child, reason: "parent reported no updates" });
      continue;
    }

    const condition = child.parentCondition?.trim();
    if (!condition) {
      fire.push(child);
      continue;
    }

    const result = evaluateCondition(
      condition,
      parentSignals,
      envelope.signals,
    );

    // Same asymmetry as delivery, same reason: an unevaluable gate must not
    // silently stop the chain.
    if (typeof result === "object" || result !== "false") {
      fire.push(child);
      continue;
    }

    skipped.push({ child, reason: `parent condition not met: ${condition}` });
  }

  return { fire, skipped };
}
