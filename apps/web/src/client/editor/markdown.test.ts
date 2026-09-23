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
  it("does not treat intra-word underscores as emphasis", () => {
    // The prose-corruption bug: `_` inside a word (identifiers, paths) was
    // read as emphasis and re-serialized with `*`, so `my_var_name` became
    // `my*var*name` on the first rich edit. CommonMark: underscore
    // emphasis only opens/closes at word boundaries. `*` is intentionally
    // unaffected (CommonMark allows intra-word `*`).
    for (const src of ["my_var_name", "snake_case_thing", "a_b_c_d", "path/to_file_name"]) {
      const doc = fromMarkdown(src);
      const inline = doc.content?.[0]?.content ?? [];
      // No emphasis mark anywhere, and the text survives whole.
      expect(inline.some(n => n.marks?.some(m => m.type === "italic" || m.type === "bold"))).toBe(false);
      expect(toMarkdown(doc).trimEnd()).toBe(src);
    }
  });

  // @verifies TSK-17
  it("still recognises real underscore emphasis at word boundaries", () => {
    // The fix must not kill legitimate `_em_` / `__bold__`.
    const em = fromMarkdown("a _word_ here");
    expect((em.content?.[0]?.content ?? []).some(n => n.marks?.some(m => m.type === "italic"))).toBe(true);
    const bold = fromMarkdown("a __word__ here");
    expect((bold.content?.[0]?.content ?? []).some(n => n.marks?.some(m => m.type === "bold"))).toBe(true);
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

  // @verifies TSK-17
  it("does not render asterisks in arithmetic/prose as emphasis", () => {
    // `5 * 3 * 2` had no flanking guard: it parsed to italic ` 3 ` and
    // RENDERED italic where the user typed asterisks. The space+digit
    // flanking guard keeps whitespace-flanked and digit-adjacent `*`
    // literal. Delete the guard (revert to `\*([\s\S]+?)\*`) and this goes
    // red — an italic mark appears and the text fragments.
    for (const src of ["5 * 3 * 2", "a * b * c", "3*4*5"]) {
      const doc = fromMarkdown(src);
      const inline = doc.content?.[0]?.content ?? [];
      expect(inline.some(n => n.marks?.some(m => m.type === "italic"))).toBe(false);
      const text = inline.map(n => n.text ?? "").join("");
      expect(text).toBe(src);
    }
  });

  // @verifies TSK-17
  it("still recognises a real asterisk italic and bold", () => {
    // The flanking guard must not kill legitimate `*italic*` / `**bold**`.
    const em = fromMarkdown("a *word* here");
    expect((em.content?.[0]?.content ?? []).some(n => n.marks?.some(m => m.type === "italic"))).toBe(true);
    const bold = fromMarkdown("a **word** here");
    expect((bold.content?.[0]?.content ?? []).some(n => n.marks?.some(m => m.type === "bold"))).toBe(true);
  });

  // @verifies TSK-17
  it("honours a backslash escape: \\*escaped\\* renders as literal *escaped*", () => {
    // Escapes were not honored anywhere: `\*escaped\*` parsed to a literal
    // `\` plus italic `escaped\`. The escape pass must consume `\*` as one
    // literal `*` with no emphasis mark, and the interaction with emphasis
    // must be correct (the escaped `*` is never seen as a delimiter).
    const doc = fromMarkdown("\\*escaped\\*");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline.some(n => n.marks?.some(m => m.type === "italic"))).toBe(false);
    const text = inline.map(n => n.text ?? "").join("");
    expect(text).toBe("*escaped*");
    // No stray backslash survived into the rendered text.
    expect(text.includes("\\")).toBe(false);
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

  // @verifies TSK-17
  it("round-trips an escaped asterisk back to its escaped form", () => {
    // The escaped `*` must re-serialize as `\*` — otherwise it would come
    // back as a bare `*` and the next parse would read it as an emphasis
    // delimiter. Break the mdEscape branch in toMarkdown and this goes red.
    const source = "\\*escaped\\*\n";
    expect(toMarkdown(fromMarkdown(source))).toBe(source);
  });

  // @verifies TSK-17
  it("preserves an ordered list's start ordinal instead of renumbering", () => {
    // The bug: toMarkdown always emitted `${idx+1}.`, so `3.`/`4.` came
    // back as `1.`/`2.` on a rich edit. The parser now carries `start` and
    // the serializer counts up from it. Revert either half and this reds.
    const source = "3. a\n4. b\n";
    const doc = fromMarkdown(source);
    const list = (doc.content ?? [])[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.attrs?.["start"]).toBe(3);
    expect(toMarkdown(doc)).toBe(source);
  });

  // @verifies TSK-17
  it("parses and round-trips a nested list, indentation preserved", () => {
    // The bug: the flat parser matched one level only, so `- outer\n  -
    // nested` flattened to two sibling items. The parser now nests by
    // indent and the serializer re-indents at depth. Revert the nesting
    // and the nested list becomes a second top-level item — red.
    const source = "- outer\n  - nested\n";
    const doc = fromMarkdown(source);
    const outer = (doc.content ?? [])[0];
    expect(outer?.type).toBe("bulletList");
    // One top-level item, whose content holds a paragraph AND a nested list.
    const items = outer?.content ?? [];
    expect(items.length).toBe(1);
    const nested = (items[0]?.content ?? []).find(
      c => c.type === "bulletList" || c.type === "orderedList",
    );
    expect(nested?.type).toBe("bulletList");
    expect(toMarkdown(doc)).toBe(source);
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

/**
 * K107 — underline (`<ins>`) and highlight (`==`).
 *
 * The two halves that are easy to ship half-done are *parse back* and
 * *do not disturb anything else*. A mark that serializes but does not
 * parse mangles the text on save-reopen-save; a mark whose regex is
 * mis-ordered silently rewires an existing one (the `~~`-before-`~`
 * scar in `inlineNodes` is exactly that failure, already paid for).
 */
describe("K107 — underline and highlight marks", () => {
  // @verifies K107
  it("parses <ins> into an underline mark, not raw text", () => {
    const doc = fromMarkdown("A <ins>under</ins> b\n");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline.some(n => n.marks?.some(m => m.type === "underline"))).toBe(true);
    // The tag itself is gone from the text — it became a mark, and the
    // literal `<ins>` surviving here is the bug this asserts against.
    const text = inline.map(n => n.text ?? "").join("");
    expect(text).toBe("A under b");
  });

  // @verifies K107
  it("parses ==text== into a highlight mark, not raw text", () => {
    const doc = fromMarkdown("A ==lit== b\n");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline.some(n => n.marks?.some(m => m.type === "highlight"))).toBe(true);
    const text = inline.map(n => n.text ?? "").join("");
    expect(text).toBe("A lit b");
  });

  // @verifies K107
  it("round-trips each new mark through parse and serialize", () => {
    // Save → reopen → save. Without the parse half these come back with
    // the delimiters doubled or stripped.
    for (const source of ["A <ins>under</ins> b\n", "A ==lit== b\n"]) {
      expect(toMarkdown(fromMarkdown(source))).toBe(source);
    }
  });

  // @verifies K107
  it("keeps markdown INSIDE <ins> parsed as marks (CommonMark §6.6)", () => {
    // Inline raw HTML does not hold its contents out of markdown
    // parsing — a block-level element would, and conflating the two was
    // the retracted "whole line must be HTML" premise. The bold inside
    // must be a real mark, and must re-emit as asterisks.
    const source = "A <ins>under **bold**</ins> b\n";
    const doc = fromMarkdown(source);
    const inline = doc.content?.[0]?.content ?? [];
    const boldRun = inline.find(n => n.marks?.some(m => m.type === "bold"));
    expect(boldRun).toBeDefined();
    // ...and it carries BOTH marks: it is bold *and* underlined.
    expect(boldRun?.marks?.some(m => m.type === "underline")).toBe(true);
    expect(toMarkdown(doc)).toBe(source);
  });

  // @verifies K107
  it("round-trips a line mixing the new marks with bold/em/strike, asterisks unchanged", () => {
    // The integration case: every mark intact, and crucially the
    // `**`/`*` spellings NOT converted to HTML. An earlier brief said a
    // line containing HTML must be fully HTML; it was wrong, and this
    // asserts the retraction.
    const source = "**b** *i* ~~s~~ <ins>u</ins> ==h== end\n";
    const doc = fromMarkdown(source);
    const marks = (doc.content?.[0]?.content ?? []).flatMap(n => n.marks ?? []).map(m => m.type);
    for (const expected of ["bold", "italic", "strike", "underline", "highlight"]) {
      expect(marks).toContain(expected);
    }
    const out = toMarkdown(doc);
    expect(out).toBe(source);
    // Explicit: the asterisks stayed asterisks rather than becoming
    // <strong>/<em>, which is the "must not break existing markdown" rule.
    expect(out).toContain("**b**");
    expect(out).toContain("*i*");
    expect(out).not.toContain("<strong>");
    expect(out).not.toContain("<em>");
  });

  // @verifies K107
  it("stores underline as <ins>, never <u>", () => {
    // `<u>` is NOT on GitHub's sanitiser allowlist — verified live
    // against api.github.com/markdown, where `A <u>x</u> b` renders as
    // `A x b` with the tag silently stripped. If the serializer ever
    // emits `<u>` the user's underline vanishes on the tool most likely
    // to read the file, with no warning. That is what this pins.
    const md = toMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "underline" }] }],
      }],
    });
    expect(md.trim()).toBe("<ins>x</ins>");
    expect(md).not.toContain("<u>");
  });

  // @verifies K107
  it("does not read == as two separate = characters or disturb a lone =", () => {
    // `=` is not a delimiter anywhere else in this tokeniser. A single
    // `=` (and a setext underline, and `a = b`) must stay literal.
    for (const src of ["a = b", "x == y is a comparison"]) {
      const doc = fromMarkdown(src);
      const inline = doc.content?.[0]?.content ?? [];
      expect(inline.some(n => n.marks?.some(m => m.type === "highlight"))).toBe(false);
      expect(inline.map(n => n.text ?? "").join("")).toBe(src);
    }
  });

  // @verifies K107
  it("still takes ~~strike~~ before ~sub~ with the new alternatives appended", () => {
    // The appended branches must not perturb the existing ordering scar.
    // If `==`/`<ins>` had been inserted mid-array the positional capture
    // groups would renumber and this is one of the things that breaks.
    const doc = fromMarkdown("~~struck~~ and ~sub~ and ==lit==\n");
    const marks = (doc.content?.[0]?.content ?? []).flatMap(n => n.marks ?? []).map(m => m.type);
    expect(marks).toContain("strike");
    expect(marks).toContain("subscript");
    expect(marks).toContain("highlight");
  });

  // @verifies K107
  it("still keeps arithmetic asterisks literal with the new alternatives appended", () => {
    // The space+digit flanking guard must survive the regex change.
    for (const src of ["5 * 3 * 2", "a * b * c", "3*4*5"]) {
      const doc = fromMarkdown(src);
      const inline = doc.content?.[0]?.content ?? [];
      expect(inline.some(n => n.marks?.some(m => m.type === "italic"))).toBe(false);
      expect(inline.map(n => n.text ?? "").join("")).toBe(src);
    }
  });

  // @verifies K107
  it("leaves a body with NO new marks byte-identical after open-and-close", () => {
    // The pre-existing guarantee, and the thing most at risk from a
    // change to the tokeniser: merely LOOKING at a body must not rewrite
    // it. Re-asserted here against the awkward spellings a serializer
    // would normalize, now that two new branches sit in the regex.
    for (const [, body] of AWKWARD_BODIES) {
      const buffer = new RichBuffer(body);
      fromMarkdown(buffer.text);
      expect(buffer.text).toBe(body);
    }
  });

  // @verifies K107
  it("does not mistake an unrelated tag for underline", () => {
    // `<ins>` is matched as a literal pair. A different tag must not be
    // swallowed by it — it stays literal text and the lossy guardrail
    // (core) is what sends the body to source mode.
    const doc = fromMarkdown("A <span>x</span> b\n");
    const inline = doc.content?.[0]?.content ?? [];
    expect(inline.some(n => n.marks?.some(m => m.type === "underline"))).toBe(false);
    expect(inline.map(n => n.text ?? "").join("")).toBe("A <span>x</span> b");
  });
});
