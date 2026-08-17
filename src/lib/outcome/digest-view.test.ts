import { describe, expect, it } from "vitest";
import { prepareDigest } from "./digest-view";

const salvaging = { salvage: true };

describe("prepareDigest", () => {
  it("leaves ordinary markdown untouched", () => {
    const body = "## Digest\n\n- one thing\n- another";

    expect(prepareDigest(body)).toEqual({ markdown: body, salvaged: false });
  });

  it("reads the digest out of a typed report and drops the narration", () => {
    const body =
      'I now have confirmation of 18 emails.\n\n<report> { "digest": "## 18 emails\\n- from pr-pulse", "severity": "info" } </report>';

    expect(prepareDigest(body, salvaging)).toEqual({
      markdown: "## 18 emails\n- from pr-pulse",
      salvaged: true,
    });
  });

  it("renders a typed no_updates as a line, not raw JSON", () => {
    const out = prepareDigest(
      '<report>{"no_updates": true}</report>',
      salvaging,
    );

    expect(out.salvaged).toBe(true);
    expect(out.markdown).toBe("_No updates._");
  });

  it("leaves a typed report alone where salvage is off", () => {
    // A workflow goal documenting the format means the shape literally.
    const body = 'Finish with <report>{"digest": "..."}</report>';

    expect(prepareDigest(body)).toEqual({
      markdown: 'Finish with \\<report>{"digest": "..."}\\</report>',
      salvaged: false,
    });
  });

  it("escapes stray tags so they render instead of vanishing", () => {
    const out = prepareDigest("Ran <thinking> then stopped");

    expect(out.markdown).toBe("Ran \\<thinking> then stopped");
    expect(out.salvaged).toBe(false);
  });

  it("leaves tags inside code spans and fences alone", () => {
    const body = "Use `<report>` like:\n\n```html\n<report>x</report>\n```";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("leaves tags in a fence the output was truncated inside", () => {
    const body = "```js\nconst a = <div>x</div>;";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("leaves tags in a tilde fence alone", () => {
    const body = "~~~\n<div>hi</div>\n~~~";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("leaves tags in an indented code block alone", () => {
    const body = "Example:\n\n    <div>hi</div>";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("still escapes a tag in an indented list continuation", () => {
    // Four spaces under a list marker is a continuation line, not code.
    const body = "- item\n    <div> keeps going";

    expect(prepareDigest(body).markdown).toBe(
      "- item\n    \\<div> keeps going",
    );
  });

  it("leaves tags in a double-backtick code span alone", () => {
    const body = "Write ``x<div>y`` verbatim";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("treats a mid-line triple-backtick run as a span, not a fence", () => {
    // A fence has to open its own line; here markdown reads a code span.
    const body = "one ``` two <div> three ``` four <span>";

    expect(prepareDigest(body).markdown).toBe(
      "one ``` two <div> three ``` four \\<span>",
    );
  });

  it("escapes a tag whose attribute holds a URL", () => {
    // The URL must not split the tag into protected and unprotected halves —
    // a tag that stops matching goes back to vanishing.
    const body = '<img src="https://x.com/a.png" alt="chart">';

    expect(prepareDigest(body).markdown).toBe(`\\${body}`);
  });

  it("escapes both halves of a link tag pair", () => {
    const body = 'See <a href="https://x.com">here</a>';

    expect(prepareDigest(body).markdown).toBe(
      'See \\<a href="https://x.com">here\\</a>',
    );
  });

  it("keeps a break before a code span as a real line break", () => {
    // What follows is judged against the line, not the mask segment the code
    // span cuts short.
    expect(prepareDigest("one<br>`code`").markdown).toBe("one  \n`code`");
  });

  it("closes a fence written with CRLF line endings", () => {
    const body = "```\r\nx\r\n```\r\nthen <div> after";

    expect(prepareDigest(body).markdown).toBe(
      "```\nx\n```\nthen \\<div> after",
    );
  });

  it("does not put a backslash inside a URL", () => {
    const body = "See https://a.com/x?a=1&b=2 and [x](http://a.com/<b>)";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("keeps an angle-bracketed link destination intact", () => {
    const body = "[docs](<https://a.com/x y>)";

    expect(prepareDigest(body).markdown).toBe(body);
  });

  it("turns a break tag into a real line break", () => {
    expect(prepareDigest("one<br>two").markdown).toBe("one  \ntwo");
    expect(prepareDigest("one<br />\ntwo").markdown).toBe("one  \ntwo");
  });

  it("turns a break inside a table cell into a space", () => {
    const body = "| a | b |\n| --- | --- |\n| one<br>two | 2 |";

    expect(prepareDigest(body).markdown).toBe(
      "| a | b |\n| --- | --- |\n| one two | 2 |",
    );
  });

  it("escapes a tag that survives inside a salvaged digest", () => {
    const body = '<report>{"digest": "Saw <b> in the subject"}</report>';

    expect(prepareDigest(body, salvaging).markdown).toBe(
      "Saw \\<b> in the subject",
    );
  });

  it("keeps an unparseable body rather than blanking it", () => {
    const body = "<report>{ not json }</report>";

    expect(prepareDigest(body, salvaging)).toEqual({
      markdown: "\\<report>{ not json }\\</report>",
      salvaged: false,
    });
  });

  it("does not swallow a digest that merely quotes JSON", () => {
    // No <report> tag, so this is content, not a mis-typed call.
    const body = '## Digest\n\nThe payload was {"digest": "x"} — unchanged.';

    expect(prepareDigest(body, salvaging)).toEqual({
      markdown: body,
      salvaged: false,
    });
  });

  it("returns empty for an empty body", () => {
    expect(prepareDigest("   ")).toEqual({ markdown: "", salvaged: false });
  });
});
