/**
 * A one-line description of a JSON value's structure, for showing the model
 * what a stored payload contains without showing it the payload.
 *
 * The point is field discovery: the agent needs to know `items` exists and
 * its elements have `from`/`subject`/`date` before it can ask for those
 * fields. Element *values* are deliberately absent — that's the sample's job.
 */

export const SAMPLE_CHARS = 400;

/** Past this depth a nested object is summarised as `object`. */
const MAX_DEPTH = 4;

/** Keys listed for an array's element shape before it is elided. */
const MAX_ELEMENT_KEYS = 12;

/** Rows shown in a descriptor's auto-projection, before it is stepped down. */
const MAX_PREVIEW_ROWS = 3;

/** Hard cap on the serialised projection, so the descriptor stays small. */
export const PREVIEW_CHARS = 600;

export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return describeArray(value, depth);

  const type = typeof value;
  if (type !== "object") return type;

  if (depth >= MAX_DEPTH) return "object";

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";

  const fields = entries
    .map(([key, child]) => `${key}: ${describeShape(child, depth + 1)}`)
    .join(", ");
  return `{ ${fields} }`;
}

function describeArray(value: unknown[], depth: number): string {
  if (value.length === 0) return "[0]";

  const first = value[0];
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    // Union the keys rather than trust element 0: a paginated API's first
    // item often lacks optional fields later ones carry.
    const keys = new Set<string>();
    for (const element of value) {
      if (element === null || typeof element !== "object") continue;
      for (const key of Object.keys(element)) keys.add(key);
      if (keys.size > MAX_ELEMENT_KEYS) break;
    }
    const listed = [...keys].slice(0, MAX_ELEMENT_KEYS);
    const suffix = keys.size > MAX_ELEMENT_KEYS ? ",…" : "";
    return `[${value.length} × {${listed.join(",")}${suffix}}]`;
  }

  return `[${value.length} × ${describeShape(first, depth + 1)}]`;
}

/**
 * The first `chars` characters of the serialised value, so the model can see
 * what fields look like — an id format, a date format — without the rest.
 */
export function sampleOf(value: unknown, chars = SAMPLE_CHARS): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or BigInt. Describing a payload must never break using it.
    return "<unserialisable>";
  }
  return json.length <= chars ? json : `${json.slice(0, chars)}…`;
}

/**
 * The first few elements of the payload's biggest array, whole.
 *
 * Every `query` call is a full model round trip — system prompt, tool
 * schemas, and history all re-sent to ask one question. For the common
 * digest payload (`{ items: [...] }`) the answer is nearly always "the first
 * few rows of the obvious list", so shipping those with the descriptor is
 * cheaper than the round trip saved. A preview, never the data: anything
 * that doesn't fit `maxChars` is dropped rather than truncated mid-row,
 * because half a row invites the model to report half a fact.
 */
export function previewRows(
  value: unknown,
  maxChars = PREVIEW_CHARS,
): unknown[] | undefined {
  const rows = largestArray(value);
  if (!rows || rows.length === 0) return undefined;

  for (
    let count = Math.min(MAX_PREVIEW_ROWS, rows.length);
    count >= 1;
    count--
  ) {
    const slice = rows.slice(0, count);
    let json: string;
    try {
      json = JSON.stringify(slice) ?? "";
    } catch {
      return undefined;
    }
    if (json.length <= maxChars) return slice;
  }
  return undefined;
}

/** The longest array anywhere in the payload, within the shape depth limit. */
function largestArray(value: unknown, depth = 0): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) {
    return undefined;
  }

  let best: unknown[] | undefined;
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = largestArray(child, depth + 1);
    if (found && (!best || found.length > best.length)) best = found;
  }
  return best;
}
