/*
 * A deliberately tiny expression language for alert conditions.
 *
 * Hand-rolled rather than `eval`, `new Function`, or a dependency, because this
 * evaluates a string a user typed into a form and stored in the database, on a
 * server, unattended. The grammar below is the entire attack surface: there is
 * no property access, no call syntax, no assignment, and an identifier resolves
 * only to a signal the workflow declared. Anything else is a parse error before
 * the workflow is ever saved.
 *
 * Evaluation is three-valued. A condition that references a signal the agent
 * did not report is `indeterminate`, not `false` — the caller decides what to
 * do about that, and for alerting it must not mean "stay quiet".
 */

export type SignalType = "number" | "string" | "boolean";

export type SignalDecl = {
  key: string;
  type: SignalType;
  description?: string;
};

export type SignalValues = Record<
  string,
  number | string | boolean | null | undefined
>;

export type Tri = "true" | "false" | "indeterminate";

type Literal = { kind: "literal"; value: number | string | boolean };
type Ident = { kind: "ident"; key: string; type: SignalType };
type Compare = {
  kind: "compare";
  op: ">" | ">=" | "<" | "<=" | "==" | "!=";
  left: Ident;
  right: Literal;
};
type And = { kind: "and"; left: Node; right: Node };
type Or = { kind: "or"; left: Node; right: Node };
type Not = { kind: "not"; operand: Node };

export type Node = Compare | And | Or | Not | Ident;

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" };

/*
 * Longest match first: "!=" has to be found before "!", and ">=" before ">",
 * or `a != 1` tokenizes as a negation followed by a stray "=".
 */
const OPERATORS = [">=", "<=", "==", "!=", "&&", "||", ">", "<", "!"] as const;

const COMPARISON_OPS = [">", ">=", "<", "<=", "==", "!="];

class ParseError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ t: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: ")" });
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = "";
      i++;
      while (i < source.length && source[i] !== quote) {
        // No escape sequences: a condition is a threshold, not a program.
        value += source[i];
        i++;
      }
      if (i >= source.length) throw new ParseError("unterminated string");
      i++;
      tokens.push({ t: "str", v: value });
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let raw = "";
      while (i < source.length && /[0-9.]/.test(source[i])) {
        raw += source[i];
        i++;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ParseError(`bad number "${raw}"`);
      tokens.push({ t: "num", v: value });
      continue;
    }

    // A leading minus is part of the number, never a subtraction operator —
    // there is no arithmetic in this grammar.
    if (ch === "-" && /[0-9]/.test(source[i + 1] ?? "")) {
      let raw = "-";
      i++;
      while (i < source.length && /[0-9.]/.test(source[i])) {
        raw += source[i];
        i++;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ParseError(`bad number "${raw}"`);
      tokens.push({ t: "num", v: value });
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ t: "op", v: op });
      i += op.length;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let raw = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
        raw += source[i];
        i++;
      }
      if (raw === "true" || raw === "false") {
        tokens.push({ t: "bool", v: raw === "true" });
      } else {
        tokens.push({ t: "ident", v: raw });
      }
      continue;
    }

    throw new ParseError(`unexpected character "${ch}"`);
  }

  return tokens;
}

/*
 * Recursive descent, lowest precedence first:
 *   or      := and ("||" and)*
 *   and     := unary ("&&" unary)*
 *   unary   := "!" unary | primary
 *   primary := "(" or ")" | ident comparison-op literal | boolean-ident
 */
function parser(tokens: Token[], declared: SignalDecl[]): Node {
  /*
   * A Map, not an object literal. An object would answer `get("constructor")`
   * with something truthy from its prototype, which is exactly the lookup an
   * attacker would try.
   */
  const bySignal = new Map(declared.map((d) => [d.key, d]));
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function isOp(value: string): boolean {
    const token = peek();
    return token?.t === "op" && token.v === value;
  }

  function parseOr(): Node {
    let left = parseAnd();
    while (isOp("||")) {
      eat();
      left = { kind: "or", left, right: parseAnd() } satisfies Or;
    }
    return left;
  }

  function parseAnd(): Node {
    let left = parseUnary();
    while (isOp("&&")) {
      eat();
      left = { kind: "and", left, right: parseUnary() } satisfies And;
    }
    return left;
  }

  function parseUnary(): Node {
    if (isOp("!")) {
      eat();
      return { kind: "not", operand: parseUnary() } satisfies Not;
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const token = peek();
    if (!token) throw new ParseError("unexpected end of condition");

    if (token.t === "(") {
      eat();
      const inner = parseOr();
      if (peek()?.t !== ")")
        throw new ParseError("missing closing parenthesis");
      eat();
      return inner;
    }

    if (token.t !== "ident") {
      throw new ParseError(
        "a condition must start with a signal name, ! or ( — a bare literal is not a condition",
      );
    }

    eat();
    const decl = bySignal.get(token.v);
    if (!decl) throw new ParseError(`unknown signal "${token.v}"`);
    const ident: Ident = { kind: "ident", key: decl.key, type: decl.type };

    const next = peek();
    const isComparison = next?.t === "op" && COMPARISON_OPS.includes(next.v);

    if (!isComparison) {
      // A bare signal is only a condition if it is already a boolean.
      if (decl.type !== "boolean") {
        throw new ParseError(
          `signal "${decl.key}" is a ${decl.type}; compare it (for example ${decl.key} > 0) or use a boolean signal`,
        );
      }
      return ident;
    }

    const op = (eat() as { t: "op"; v: string }).v as Compare["op"];
    const rhs = eat();
    if (!rhs || (rhs.t !== "num" && rhs.t !== "str" && rhs.t !== "bool")) {
      throw new ParseError(
        `the right side of "${op}" must be a number, string or boolean literal`,
      );
    }

    const literalType: SignalType =
      rhs.t === "num" ? "number" : rhs.t === "str" ? "string" : "boolean";

    if (literalType !== decl.type) {
      throw new ParseError(
        `type mismatch: signal "${decl.key}" is a ${decl.type} but is compared to a ${literalType}`,
      );
    }

    if (decl.type !== "number" && op !== "==" && op !== "!=") {
      throw new ParseError(
        `"${op}" needs a number; signal "${decl.key}" is a ${decl.type}`,
      );
    }

    return {
      kind: "compare",
      op,
      left: ident,
      right: { kind: "literal", value: rhs.v },
    };
  }

  const ast = parseOr();
  if (pos !== tokens.length) {
    throw new ParseError("unexpected trailing input");
  }
  return ast;
}

export function parseCondition(
  source: string,
  declared: SignalDecl[],
): { ok: true; ast: Node } | { ok: false; error: string } {
  try {
    const trimmed = source.trim();
    if (!trimmed) return { ok: false, error: "condition is empty" };
    return { ok: true, ast: parser(tokenize(trimmed), declared) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function evalNode(node: Node, values: SignalValues): Tri {
  switch (node.kind) {
    case "ident": {
      const value = values[node.key];
      if (value === undefined || value === null) return "indeterminate";
      if (typeof value !== "boolean") return "indeterminate";
      return value ? "true" : "false";
    }

    case "not": {
      const inner = evalNode(node.operand, values);
      if (inner === "indeterminate") return "indeterminate";
      return inner === "true" ? "false" : "true";
    }

    case "and": {
      // A definite `false` on either side settles it, even if the other side
      // could not be evaluated — that is what makes a partly-reported envelope
      // still useful rather than uniformly indeterminate.
      const left = evalNode(node.left, values);
      if (left === "false") return "false";
      const right = evalNode(node.right, values);
      if (right === "false") return "false";
      if (left === "indeterminate" || right === "indeterminate") {
        return "indeterminate";
      }
      return "true";
    }

    case "or": {
      const left = evalNode(node.left, values);
      if (left === "true") return "true";
      const right = evalNode(node.right, values);
      if (right === "true") return "true";
      if (left === "indeterminate" || right === "indeterminate") {
        return "indeterminate";
      }
      return "false";
    }

    case "compare": {
      const value = values[node.left.key];
      if (value === undefined || value === null) return "indeterminate";
      const literal = node.right.value;

      /*
       * The reported value has to match its own declaration. The parser checked
       * the literal against the declared type, but nothing can check what the
       * agent actually put in the envelope until it is here — and a string
       * where a number was promised is not comparable, nor is it `false`.
       */
      if (typeof value !== typeof literal) return "indeterminate";

      switch (node.op) {
        case "==":
          return value === literal ? "true" : "false";
        case "!=":
          return value !== literal ? "true" : "false";
        case ">":
          return value > literal ? "true" : "false";
        case ">=":
          return value >= literal ? "true" : "false";
        case "<":
          return value < literal ? "true" : "false";
        case "<=":
          return value <= literal ? "true" : "false";
      }

      return "indeterminate";
    }
  }
}

export function evaluateCondition(
  source: string,
  declared: SignalDecl[],
  values: SignalValues,
): Tri | { error: string } {
  const parsed = parseCondition(source, declared);
  if (!parsed.ok) return { error: parsed.error };
  return evalNode(parsed.ast, values);
}
