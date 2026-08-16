import { describeShape } from "./shape";

/*
 * The agent's only way to read a stored payload.
 *
 * A fixed operation set rather than an expression language, on purpose: this
 * runs unattended, so a filter the model gets subtly wrong is a silently wrong
 * digest. These operations either apply or return an error naming the shape
 * that was actually there, which the agent can act on in one more step.
 */

export type WhereSpec = {
  field: string;
  equals?: string | number | boolean;
  contains?: string;
  after?: string;
  before?: string;
};

export type QuerySpec = {
  path?: string;
  pick?: string[];
  where?: WhereSpec;
  sort?: { field: string; direction?: "asc" | "desc" };
  /** Rows to skip before `take`, so a large array can be paged in order. */
  offset?: number;
  take?: number;
  count?: boolean;
};

export type QueryOutcome =
  | {
      ok: true;
      value: unknown;
      /** Set when `offset`/`take` sliced an array, so the model knows how to page on. */
      total?: number;
      truncated?: boolean;
    }
  | { ok: false; error: string; shapeAtPath?: string };

type Row = Record<string, unknown>;

export function runQuery(root: unknown, spec: QuerySpec): QueryOutcome {
  const located = walk(root, spec.path);
  if (!located.ok) return located;

  let value = located.value;

  if (spec.where) {
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: `cannot filter: the value at "${spec.path ?? "root"}" is not a list`,
        shapeAtPath: describeShape(value),
      };
    }
    const rows = value as Row[];
    if (
      !rows.some((row) => isRow(row) && Object.hasOwn(row, spec.where!.field))
    ) {
      return {
        ok: false,
        error: `no element has a "${spec.where.field}" field`,
        shapeAtPath: describeShape(value),
      };
    }
    value = rows.filter((row) => matches(row, spec.where!));
  }

  if (spec.sort && Array.isArray(value)) {
    const { field, direction = "asc" } = spec.sort;
    const sign = direction === "desc" ? -1 : 1;
    value = [...(value as Row[])].sort(
      (a, b) => sign * compare(a?.[field], b?.[field]),
    );
  }

  if (spec.count) {
    return {
      ok: true,
      value: { count: Array.isArray(value) ? value.length : 1 },
    };
  }

  // `total`/`truncated` mirror the string path's reporting, so a large array
  // can be paged the same way: re-call with the next `offset` while
  // `truncated` is true.
  let total: number | undefined;
  let truncated: boolean | undefined;

  if (Array.isArray(value) && (spec.offset || typeof spec.take === "number")) {
    const offset = Math.max(0, spec.offset ?? 0);
    const end =
      typeof spec.take === "number"
        ? offset + Math.max(0, spec.take)
        : undefined;
    total = value.length;
    const sliced = value.slice(offset, end);
    truncated = offset + sliced.length < value.length;
    value = sliced;
  }

  if (spec.pick?.length) {
    value = Array.isArray(value)
      ? (value as Row[]).map((row) => project(row, spec.pick!))
      : project(value as Row, spec.pick);
  }

  return { ok: true, value, total, truncated };
}

function walk(root: unknown, path?: string): QueryOutcome {
  if (!path) return { ok: true, value: root };

  let current: unknown = root;
  const segments = path.split(".");

  for (const [index, segment] of segments.entries()) {
    if (current === null || typeof current !== "object") {
      return {
        ok: false,
        error: `no "${segment}" at path "${segments.slice(0, index).join(".") || "root"}"`,
        shapeAtPath: describeShape(current),
      };
    }
    const container = current as Row;
    // Own keys only: `in` walks the prototype chain, so "constructor" or
    // "toString" would resolve to a function read back as data.
    if (!Object.hasOwn(container, segment)) {
      return {
        ok: false,
        error: `no "${segment}" at path "${segments.slice(0, index).join(".") || "root"}"`,
        shapeAtPath: describeShape(current),
      };
    }
    current = container[segment];
  }

  return { ok: true, value: current };
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matches(row: Row, where: WhereSpec): boolean {
  if (!isRow(row)) return false;
  if (!Object.hasOwn(row, where.field)) return false;
  const value = row[where.field];

  if (where.equals !== undefined && value !== where.equals) return false;

  if (where.contains !== undefined) {
    if (typeof value !== "string") return false;
    if (!value.toLowerCase().includes(where.contains.toLowerCase())) {
      return false;
    }
  }

  // A missing or null field must never satisfy after/before.
  if (
    (where.after !== undefined || where.before !== undefined) &&
    value == null
  ) {
    return false;
  }

  // Lexicographic on strings (ISO timestamps sort correctly that way) and
  // numeric on numbers — covers both an ISO `date` and a unix `ts`.
  if (where.after !== undefined && compare(value, where.after) <= 0) {
    return false;
  }
  if (where.before !== undefined && compare(value, where.before) >= 0) {
    return false;
  }

  return true;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  // A number against a numeric-looking string (mixed data from an external
  // tool) must still compare numerically — otherwise "9" sorts after "10"
  // as strings, giving an order inconsistent with the all-number rows.
  const numA = typeof a === "number" ? a : coerceNumber(a);
  const numB = typeof b === "number" ? b : coerceNumber(b);
  if (numA !== null && numB !== null) return numA - numB;

  const left = a == null ? "" : String(a);
  const right = b == null ? "" : String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A string that is entirely numeric, or null — never `NaN`-coerces "" or "1a". */
function coerceNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Missing keys are dropped, not emitted as `undefined` — they serialise to noise. */
function project(row: Row, fields: string[]): Row {
  if (!isRow(row)) return row;
  const out: Row = {};
  for (const field of fields) {
    if (Object.hasOwn(row, field)) out[field] = row[field];
  }
  return out;
}
