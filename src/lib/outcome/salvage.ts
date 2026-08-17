import {
  buildReportSchema,
  normalizeEnvelope,
  type Envelope,
} from "./envelope";
import type { SignalDecl } from "./condition";

/*
 * Recovering a report the model wrote instead of called.
 *
 * Some models end a run by *describing* the report — `<report>{...}</report>`
 * in the final message — rather than calling the tool. The run then has no
 * envelope, and every path after it is wrong: a workflow with signals fails
 * with `no_report`, and one without used to publish the whole assistant
 * transcript, thinking narration and raw XML included, as the digest.
 *
 * The intent is unambiguous and the payload is right there, so we parse it
 * back out. This is a salvage path, not a second protocol: it only reads what
 * the tool would have accepted, and anything it can't parse stays a failure.
 */

const REPORT_TAG = /<report[^>]*>([\s\S]*?)<\/report>/gi;
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** Report-shaped JSON blocks in `text`, last one first. */
function candidates(text: string, taggedOnly: boolean): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(REPORT_TAG)) {
    found.push(match[1]);
  }

  /*
   * No tags: the model may have emitted the bare JSON call arguments. That
   * only counts when the JSON *is* the whole message (a fence around it is
   * still the whole message — `parse` unwraps it).
   *
   * Digging the outermost braces out of surrounding prose is what makes this
   * dangerous rather than helpful: a digest that quotes a JSON payload would
   * be replaced by whatever that payload's `digest` field happened to say,
   * and — unlike the read path — this one delivers. A wrong digest in Slack
   * is worse than the `no_report` failure it saves.
   */
  if (found.length === 0 && !taggedOnly) found.push(text);

  // Last wins, matching the tool's "last call wins" rule for a model that
  // corrected itself.
  return found.reverse();
}

function parse(raw: string): unknown {
  const inner = raw.trim().replace(FENCE, "$1").trim();
  if (!inner.startsWith("{")) return null;
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

/**
 * Reads an envelope out of a final message that was never a tool call.
 *
 * Returns null when there is nothing report-shaped to read — the caller
 * treats that as the run having produced no outcome.
 */
export function salvageEnvelope(
  text: string,
  declared: SignalDecl[],
): Envelope | null {
  // The same schema the SDK applies to a real call, for the same reason: a
  // `z.object` strips keys it doesn't know, so a hallucinated signal costs the
  // model that one key and nothing else. Skipping this step made salvage
  // *stricter* than the tool — a digest the tool would have delivered failed
  // the run instead.
  const schema = buildReportSchema(declared);

  for (const parsed of typedReports(text)) {
    const stripped = schema.safeParse(parsed);
    if (!stripped.success) continue;
    const outcome = normalizeEnvelope(stripped.data, declared);
    if (outcome.ok) return outcome.envelope;
  }
  return null;
}

/**
 * Every report-shaped object typed into `text`, most recent first.
 *
 * Separate from `salvageEnvelope` because the renderer needs the same reading
 * without a signal schema to validate against — it is showing a digest that
 * was written long ago, not deciding a run's outcome.
 *
 * @param taggedOnly require an explicit `<report>` block. The renderer sets
 * it: at read time a bare JSON object is far more likely to be something the
 * digest is *about* than a mis-typed call, and swallowing the whole body for
 * it would lose a real digest.
 */
export function typedReports(
  text: string,
  { taggedOnly = false }: { taggedOnly?: boolean } = {},
): Record<string, unknown>[] {
  if (!text.includes("{")) return [];

  const out: Record<string, unknown>[] = [];
  for (const candidate of candidates(text, taggedOnly)) {
    const parsed = parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    out.push(parsed as Record<string, unknown>);
  }
  return out;
}
