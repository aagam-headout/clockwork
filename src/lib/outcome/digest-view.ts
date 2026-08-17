import { typedReports } from "./salvage";

/*
 * Making a stored digest safe to read.
 *
 * Two things reach the renderer that markdown has no good answer for:
 *
 * - A report the model typed instead of called: `<report>{...}</report>`,
 *   usually with its thinking narration in front of it. Raw HTML is off in
 *   the renderer, so the tags vanish and the JSON lands in the page as prose.
 *   Rows written before the executor started salvaging these still hold them,
 *   so the fix has to work at read time too.
 * - Any other stray tag-shaped text, which disappears the same silent way.
 *   Escaping it makes it visible instead — wrong-looking output beats output
 *   that quietly loses a line.
 *
 * Escaping is the delicate half. A backslash is an escape in prose and a
 * literal character inside code, so escaping a region markdown considers code
 * puts a visible `\` in front of every tag in it; skipping a region that is
 * *not* code loses the tag again. Both directions were live bugs when this
 * worked off a single `code` regex, so the code map below is built line by
 * line instead, the way a markdown parser reads it.
 */

export type PreparedDigest = {
  /** Markdown safe to hand to the renderer. */
  markdown: string;
  /** True when the body was a typed report and we read the digest out of it. */
  salvaged: boolean;
};

/** A tag-shaped run the markdown renderer would drop on the floor. */
const TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>/g;
/**
 * `<br>` in its three spellings. Models reach for it inside table cells,
 * where GFM has no other way to break a line, so it is intent worth keeping
 * rather than a stray tag worth showing.
 */
const BREAK = /<br\s*\/?>/gi;

/** Opens a fenced block: up to three spaces, then three or more ` or ~. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** Closes one: the same character, at least as long, alone on its line. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** An indented code block's line — four spaces or a tab. */
const INDENTED = /^(?: {4}|\t)/;
/** A list marker, whose continuation lines are indented but are not code. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** A GFM table row, where a hard break would split the row in two. */
const TABLE_ROW = /^ {0,3}\|/;

/** Backtick runs, the delimiters of an inline code span. */
const TICKS = /`+/g;
/** An inline link or image destination, angle-bracketed or bare. */
const DESTINATION = /\]\(\s*(?:<[^>\n]*>|[^\s)]*)/g;

/**
 * Marks every character of `text` that markdown reads as code or as a link
 * target — the spans escaping has to leave exactly as the model wrote them.
 */
function protectedMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const mark = (from: number, to: number) => mask.fill(1, from, to);

  let offset = 0;
  let fence: { char: string; len: number } | null = null;
  let afterBlank = true;
  let inIndented = false;
  let inList = false;

  for (const line of text.split("\n")) {
    const end = offset + line.length;
    const blank = line.trim() === "";

    if (fence) {
      // An unclosed fence runs to the end of the body — the shape truncated
      // agent output arrives in — so its contents stay protected either way.
      mark(offset, end);
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence = null;
      }
    } else {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        fence = { char: open[1][0], len: open[1].length };
        mark(offset, end);
      } else if (INDENTED.test(line) && !inList && (afterBlank || inIndented)) {
        // Indented code can't interrupt a paragraph, and inside a list the
        // same indent is a continuation line instead — hence both guards.
        mark(offset, end);
        inIndented = true;
      } else {
        inIndented = false;
        if (!blank) inList = LIST_ITEM.test(line);
        markInline(line, offset, mark);
      }
    }

    afterBlank = blank;
    offset = end + 1;
  }

  return mask;
}

/**
 * Inline code spans and link destinations within one prose line.
 *
 * Bare URLs are deliberately *not* protected. A tag match starts at `<`, which
 * a bare URL can't contain, so protecting one guards nothing — but a URL
 * inside a tag's attribute (`<img src="https://…">`) would split that tag into
 * protected and unprotected halves, and the tag would stop matching and go
 * back to vanishing.
 */
function markInline(
  line: string,
  offset: number,
  mark: (from: number, to: number) => void,
) {
  const runs = [...line.matchAll(TICKS)];
  for (let i = 0; i < runs.length; i++) {
    // A span closes on the next run of exactly the same length; an unmatched
    // run is ordinary text, so it protects nothing.
    const close = runs.findIndex(
      (run, j) => j > i && run[0].length === runs[i][0].length,
    );
    if (close === -1) continue;
    mark(
      offset + runs[i].index,
      offset + runs[close].index + runs[close][0].length,
    );
    i = close;
  }

  for (const match of line.matchAll(DESTINATION)) {
    mark(offset + match.index, offset + match.index + match[0].length);
  }
}

/**
 * Escapes tag-shaped text outside code so it renders as itself, and turns
 * `<br>` into the line break it stands for.
 */
function escapeTags(text: string): string {
  const mask = protectedMask(text);
  let out = "";
  let offset = 0;

  for (const line of text.split("\n")) {
    const end = offset + line.length;
    // A hard break inside a table row would end the row, so cells settle for
    // a space; at a line's end the two trailing spaces *are* the break.
    const inTable = TABLE_ROW.test(line);

    let cursor = offset;
    while (cursor < end) {
      let run = cursor;
      while (run < end && mask[run] === mask[cursor]) run++;
      const segment = text.slice(cursor, run);
      const from = cursor;
      out += mask[cursor]
        ? segment
        : segment
            .replace(BREAK, (tag: string, at: number) =>
              inTable
                ? " "
                : // What follows is measured against the rest of the *line*,
                  // not this mask segment: a break before a code span or a
                  // link ends the segment early, and reading only the segment
                  // would call a mid-line break a trailing one and drop it.
                  text.slice(from + at + tag.length, end).trim()
                  ? "  \n"
                  : "  ",
            )
            .replace(TAG, (tag) => `\\${tag}`);
      cursor = run;
    }

    out += end < text.length ? "\n" : "";
    offset = end + 1;
  }

  return out;
}

/**
 * Reads a stored digest body into markdown worth rendering.
 *
 * Never throws and never returns empty for a non-empty body: a body it can't
 * improve comes back escaped rather than dropped.
 *
 * @param salvage read a typed `<report>` block back into its digest. Only the
 * digest render sites set it — a workflow goal or a chat turn may legitimately
 * *contain* that shape while writing about it, and reducing such a body to the
 * report's `digest` field would show the reader something they never wrote.
 */
export function prepareDigest(
  body: string,
  { salvage = false }: { salvage?: boolean } = {},
): PreparedDigest {
  // Line endings are normalized before anything reads lines. A digest quoting
  // an email or an HTTP body arrives with CRLF, and a stray `\r` left on a
  // closing fence stops it closing — the fence then runs to the end of the
  // body and every tag after it goes back to vanishing.
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) return { markdown: "", salvaged: false };

  if (salvage) {
    for (const report of typedReports(text, { taggedOnly: true })) {
      const digest = report.digest;
      if (typeof digest === "string" && digest.trim()) {
        return { markdown: escapeTags(digest.trim()), salvaged: true };
      }
      if (report.no_updates === true) {
        return { markdown: "_No updates._", salvaged: true };
      }
    }
  }

  return { markdown: escapeTags(text), salvaged: false };
}
