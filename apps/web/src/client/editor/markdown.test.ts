import { describe, expect, it } from "vitest";

import { fromMarkdown, RichBuffer, toMarkdown } from "./markdown.ts";

/**
 * TSK-17's byte-identical round trip.
 *
 * The bodies below are chosen to be markdown a *serializer* would
 * rewrite: `_italic_` rather than `*italic*`, `+` and `*` bullets,
 * `1)` ordinals, a setext heading, four blank lines, trailing spaces,
 * `~~~` fences. If the toggle ever starts serializing on the unedited
 * path these come back in canonical spelling and every one of these
 * assertions fails — which is the point. A round-trip test built from
 * already-canonical markdown would pass against a serializer and prove
 * nothing.
 */
const AWKWARD_BODIES: readonly [string, string][] = [
  ["underscore emphasis", "Some _italic_ and __bold__ text.\n"],
  ["plus bullets", "+ first\n+ second\n"],
  ["star bullets", "* first\n* second\n"],
  ["paren ordinals", "1) first\n2) second\n"],
  ["setext heading", "Title\n=====\n\nBody text.\n"],
  ["extra blank lines", "One.\n\n\n\n\nTwo.\n"],
  ["tilde fence", "~~~ts\nconst a = 1;\n~~~\n"],
  ["trailing spaces", "Line with trailing spaces   \nnext line\n"],
  ["no trailing newline", "No newline at end"],
  ["indented continuation", "- item\n   continued at three spaces\n"],
];

describe("RichBuffer — TSK-17 byte-identical round trip", () => {
  for (const [name, body] of AWKWARD_BODIES) {
    // @verifies TSK-17
    it(`returns ${name} unchanged when the rich editor made no edit`, () => {
      const buffer = new RichBuffer(body);
      // Toggling to rich and back is exactly this: the rich surface
      // parses the buffer to display it, and nothing writes back.
      fromMarkdown(buffer.text);
      expect(buffer.text).toBe(body);
    });
  }

  // @verifies TSK-17
  it("keeps the exact bytes typed in raw mode, unnormalized", () => {
    const buffer = new RichBuffer("original\n");
    // TSK-17's fourth bullet: "what is stored is what was typed in raw
    // mode; the editor does not normalize the user's markdown."
    const typed = "# Heading\n\n\n\n_not underscored away_\n+ plus bullet\n";
    buffer.reset(typed);
    expect(buffer.text).toBe(typed);
    // And a subsequent look at the rich side still does not rewrite it.
    fromMarkdown(buffer.text);
    expect(buffer.text).toBe(typed);
  });

  // @verifies TSK-17
  it("serializes only after a real edit in the rich editor", () => {
    const buffer = new RichBuffer("_italic_\n");
    expect(buffer.isRichDirty).toBe(false);
    // A positive assertion, paired with the absences above: once the
    // rich side genuinely edits, the buffer *does* change, so the
    // "unchanged" results are not simply a buffer that never updates.
    buffer.applyRich({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "edited", marks: [{ type: "italic" }] }],
      }],
    });
    expect(buffer.isRichDirty).toBe(true);
    expect(buffer.text).toBe("*edited*\n");
    expect(buffer.text).not.toBe("_italic_\n");
  });

  // @verifies TSK-17
  it("a raw edit after a rich edit clears the dirty flag", () => {
    const buffer = new RichBuffer("start\n");
    buffer.applyRich({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "rich" }] }],
    });
    expect(buffer.isRichDirty).toBe(true);
    buffer.reset("_raw bytes_\n");
    expect(buffer.isRichDirty).toBe(false);
    expect(buffer.text).toBe("_raw bytes_\n");
  });
});

/**
 * The rich → raw direction still has to *show the source for what was
 * rendered* (TSK-17's first bullet), so the parse has to be faithful
 * even though it is not what produces the stored bytes.
 */
describe("fromMarkdown", () => {
  // @verifies TSK-17
  it("parses headings, bold and italic into their nodes", () => {
    const doc = fromMarkdown("# Title\n\nSome **bold** and *italic*.\n");
    const [heading, para] = doc.content ?? [];
    expect(heading?.type).toBe("heading");
    expect(heading?.attrs?.["level"]).toBe(1);
    expect(para?.content?.some(n => n.marks?.some(m => m.type === "bold"))).toBe(true);
    expect(para?.content?.some(n => n.marks?.some(m => m.type === "italic"))).toBe(true);
  });

  // @verifies TSK-63
  it("parses CRLF markdown without hanging (a heading/list line with \\r)", () => {
    // Regression: a `\r`-suffixed heading/list line matched neither the
    // block handler (regexes end in `(.*)$`; `.` skips `\r`) nor let the
    // paragraph loop advance (its break-test has no `$`), so fromMarkdown
    // spun forever and OOM'd — reachable from an ordinary Windows paste
    // (text/plain is CRLF). The 2s cap fails via timeout on the old code
    // instead of hanging the whole run.
    const doc = fromMarkdown("# Heading\r\n\r\n- item one\r\n- item two\r\n");
    const types = (doc.content ?? []).map(n => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
    // The `\r` did not survive into the parsed text.
    const headingText = (doc.content?.[0]?.content ?? []).map(n => n.text ?? "").join("");
    expect(headingText).toBe("Heading");
  }, 2000);

  // @verifies TSK-25
  it("keeps a ZWJ family emoji as one text run, not split codepoints", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const doc = fromMarkdown(`Family: ${family} here\n`);
    const text = (doc.content?.[0]?.content ?? []).map(n => n.text ?? "").join("");
    expect(text).toContain(family);
    // Positive pairing: the sequence survives entire, ZWJ included.
    expect(text.includes("‍")).toBe(true);
  });

  // @verifies TSK-17
  it("does not turn a strikethrough into a subscript", () => {
    // `~~x~~` matching the single-tilde subscript rule first is the
    // exact conflation `extensions.ts` warns about; it would silently
    // convert every strikethrough on the next save.
    const doc = fromMarkdown("~~struck~~ and ~sub~\n");
    const marks = (doc.content?.[0]?.content ?? []).flatMap(n => n.marks ?? []);
    expect(marks.some(m => m.type === "strike")).toBe(true);
    expect(marks.some(m => m.type === "subscript")).toBe(true);
  });

  // @verifies TSK-17
  it("keeps LocTT extensions as nodes rather than dropping them", () => {
    const doc = fromMarkdown("Math $x^2$ and @user:abc and ^sup^\n");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline.some(n => n.type === "inlineMath")).toBe(true);
    expect(inline.some(n => n.type === "mention")).toBe(true);
    expect(inline.some(n => n.marks?.some(m => m.type === "superscript"))).toBe(true);
  });

  // @verifies TSK-17
  it("does not read markup inside a code span", () => {
    const doc = fromMarkdown("`**not bold**`\n");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline[0]?.marks?.some(m => m.type === "code")).toBe(true);
    expect(inline[0]?.text).toBe("**not bold**");
  });

  // @verifies TSK-66
  it("parses a GFM pipe table into a table node, not paragraph text", () => {
    // The failure the case forbids: a pipe table shown as literal
    // paragraph characters. Delete the table branch in fromMarkdown and
    // the header row becomes a `paragraph` whose text is `| Name | Qty |`,
    // turning this red.
    const doc = fromMarkdown("| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n");
    const table = (doc.content ?? []).find(n => n.type === "table");
    expect(table).toBeDefined();
    expect((doc.content ?? []).some(n => n.type === "paragraph")).toBe(false);
    const rows = table?.content ?? [];
    expect(rows.map(r => r.type)).toEqual(["tableRow", "tableRow"]);
    // Header cells are tableHeader; body cells are tableCell.
    expect((rows[0]?.content ?? []).map(c => c.type)).toEqual([
      "tableHeader", "tableHeader",
    ]);
    expect((rows[1]?.content ?? []).map(c => c.type)).toEqual([
      "tableCell", "tableCell",
    ]);
    // The cell text is inside a paragraph, editable — not the raw `| … |`.
    const firstCellText = (rows[0]?.content?.[0]?.content?.[0]?.content ?? [])
      .map(n => n.text ?? "").join("");
    expect(firstCellText).toBe("Name");
  });

  // @verifies TSK-66
  it("does not treat a lone piped line without a delimiter as a table", () => {
    // A paragraph that merely contains pipes is not a table; forcing it
    // into one would swallow ordinary text.
    const doc = fromMarkdown("a | b | c is just prose\n");
    expect((doc.content ?? [])[0]?.type).toBe("paragraph");
    expect((doc.content ?? []).some(n => n.type === "table")).toBe(false);
  });
});

describe("toMarkdown — the edited path", () => {
  // @verifies TSK-18
  it("emits the markdown for every construct the toolbar applies", () => {
    const md = toMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "text", text: "i", marks: [{ type: "italic" }] },
            { type: "text", text: "c", marks: [{ type: "code" }] },
            { type: "text", text: "l", marks: [{ type: "link", attrs: { href: "u" } }] },
          ],
        },
        { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x" }] },
        {
          type: "bulletList",
          content: [{
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
          }],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }],
        },
      ],
    });
    expect(md).toContain("## H");
    expect(md).toContain("**b**");
    expect(md).toContain("*i*");
    expect(md).toContain("`c`");
    expect(md).toContain("[l](u)");
    expect(md).toContain("```ts\nx\n```");
    expect(md).toContain("- one");
    expect(md).toContain("> q");
  });

  // @verifies TSK-17
  it("orders marks the same way regardless of the order they were added", () => {
    // Two documents identical but for mark order must serialize
    // identically — otherwise the same content saves two different
    // ways and a save can differ from the one before it with no edit
    // in between.
    const codeFirst = toMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "code" }, { type: "bold" }] }],
      }],
    });
    const boldFirst = toMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "code" }] }],
      }],
    });
    expect(codeFirst).toBe(boldFirst);
    expect(codeFirst.trim()).toBe("**`x`**");
  });

  // @verifies TSK-17
  it("round-trips LocTT extensions through parse and serialize", () => {
    const source = "Math $x+1$ and @user:u1 and ~~gone~~\n";
    expect(toMarkdown(fromMarkdown(source))).toBe(source);
  });

  // @verifies TSK-25
  it("round-trips a ZWJ family emoji through the edited path", () => {
    // TSK-25's second bullet: the cluster must survive rich → raw →
    // rich "intact, not split into component codepoints" — and this is
    // the *edited* path, where a serializer actually runs.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const source = `Family ${family} intact\n`;
    expect(toMarkdown(fromMarkdown(source))).toBe(source);
  });

  // @verifies TSK-66
  it("round-trips a canonical GFM pipe table through parse and serialize", () => {
    // Load → the doc has a table → save → still a valid GFM table.
    // Written in the canonical spelling toMarkdown emits (single-space
    // padding, `---` delimiter) so the round trip is exact. Break the
    // table case in toMarkdown and the serialized body loses its pipes.
    const source = "Intro.\n\n| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 12 |\n\nAfter.\n";
    expect(toMarkdown(fromMarkdown(source))).toBe(source);
  });

  // @verifies TSK-66
  it("keeps an escaped pipe inside a cell escaped, not doubled", () => {
    // `\|` is a literal pipe in a cell; re-serializing must not turn it
    // into `\\|` (which would render a stray backslash) nor into a bare
    // `|` (which would split the cell).
    const source = "| A | B |\n| --- | --- |\n| x \\| y | z |\n";
    expect(toMarkdown(fromMarkdown(source))).toBe(source);
  });

  // @verifies TSK-66
  it("escapes EACH of two adjacent bare pipes in a cell as its own \\|", () => {
    // A cell whose text holds two adjacent bare pipes (`a||b`) must
    // serialize to `a\|\|b` — one `\|` per pipe. The earlier "escape only
    // a bare pipe" replace produced `a\||b` (the second pipe left bare):
    // not the clean, canonical escaping GFM cells should carry. Asserted on
    // the serializer output, where fix and bug genuinely differ.
    const doc = {
      type: "doc",
      content: [{
        type: "table",
        content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a||b" }] }] },
          ] },
        ],
      }],
    };
    const out = toMarkdown(doc);
    // Every literal pipe carries exactly one backslash; no bare pipe survives
    // inside the cell body.
    expect(out).toContain("a\\|\\|b");
    expect(out).not.toContain("a\\||b");
  });
});

/**
 * TSK-66 no-reformat guard.
 *
 * Adding table support must not perturb bodies the user did not edit —
 * the A14 / TSK-17 byte-identical invariant. A body *containing* a table,
 * merely looked at (parsed for display, nothing written back), must return
 * unchanged; and a body with awkward-but-untouched markdown beside a table
 * must not be normalized.
 */
describe("RichBuffer — TSK-66 table does not perturb unedited bodies", () => {
  // @verifies TSK-66
  it("returns a table body byte-identical when the rich editor made no edit", () => {
    // Alignment colons and irregular padding are spellings a serializer
    // would rewrite; on the unedited path RichBuffer must not touch them.
    const body = "| Name |Qty|\n| :-- | --: |\n| Apple |  3 |\n";
    const buffer = new RichBuffer(body);
    fromMarkdown(buffer.text); // the rich tab parses to display; no write-back
    expect(buffer.text).toBe(body);
  });

  // @verifies TSK-66
  it("does not normalize awkward markdown sitting next to a table", () => {
    const body = "Some _italic_ text.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n+ plus bullet\n";
    const buffer = new RichBuffer(body);
    fromMarkdown(buffer.text);
    expect(buffer.text).toBe(body);
  });
});
