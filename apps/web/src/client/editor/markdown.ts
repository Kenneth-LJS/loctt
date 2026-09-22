/**
 * Markdown ⇄ TipTap bridge for the body editor (TSK-17).
 *
 * ## Why this file exists rather than a serializer dependency
 *
 * TSK-17's third bullet is the hard one:
 *
 * > Round-tripping rich → raw → rich without edits leaves the stored
 * > body **byte-identical** — the toggle must not silently reformat or
 * > reorder markdown.
 *
 * and its fourth restates it from the user's side: *"the editor does
 * not normalize the user's markdown against their will."*
 *
 * **No markdown→AST→markdown pipeline can satisfy that**, and the
 * reason is structural rather than a matter of picking a better
 * library. Markdown is many-to-one: `*em*` and `_em_` are the same
 * node, so are `# H` and its setext form, so are `-`/`*`/`+` bullets,
 * `1.`/`1)` ordinals, three-space and four-space continuation indents,
 * fenced blocks opened with backticks or tildes, and any number of
 * blank lines between blocks. A serializer must pick one spelling per
 * node. Every body written in the other spelling is silently rewritten
 * the first time the user glances at the rich tab — which is precisely
 * the failure the case names, and it would be *invisible* to a test
 * that only round-trips markdown the serializer happens to already
 * emit in canonical form.
 *
 * ## The design: markdown is the buffer, rich is a projection
 *
 * So the source of truth is never the ProseMirror document. The
 * editor holds **markdown text**, and:
 *
 *  - **rich → raw** hands back the buffer *unchanged* when the visual
 *    editor made no edit. There is nothing to serialize, so there is
 *    nothing to normalize. Byte-identical is not "achieved" here, it
 *    is the absence of an operation.
 *  - the visual editor serializes **only** when the user actually
 *    changed something in it, and then only from that point on.
 *
 * `toMarkdown` below is therefore reached on the edited path only.
 * `RichBuffer` is what enforces the distinction, and it is the thing
 * TSK-17's round-trip test should be pointed at.
 *
 * A consequence worth stating plainly, because it is a real cost: a
 * user who edits in rich mode *does* get their whole body normalized
 * to this module's spellings, not just the paragraph they touched.
 * That is unavoidable for any WYSIWYG surface over markdown — the
 * document has no memory of which bytes produced which node. What the
 * design buys is that merely *looking* costs nothing, which is the
 * common case and the one the user cannot anticipate.
 */

import type { JSONContent } from "@tiptap/core";

/**
 * A markdown buffer that knows whether the rich editor has touched it.
 *
 * The whole of TSK-17's byte-identical requirement lives in `text`
 * returning `original` while `dirty` is false. Deleting the `dirty`
 * check turns this into an ordinary serializer round-trip and the
 * round-trip test goes red — which is the mutation that proves that
 * test asserts something.
 */
export class RichBuffer {
  /** The markdown exactly as loaded or last written in raw mode. */
  private original: string;
  /** Set once the visual editor reports a real document change. */
  private dirty = false;
  private serialized: string | null = null;

  constructor(markdown: string) {
    this.original = markdown;
  }

  /** Replaces the buffer wholesale — a raw-mode edit, or a fresh load. */
  reset(markdown: string): void {
    this.original = markdown;
    this.dirty = false;
    this.serialized = null;
  }

  /**
   * Records an edit made in the visual editor.
   *
   * Called only from TipTap's `onUpdate`, and only for transactions
   * that changed the document — a selection move is not an edit, and
   * treating it as one would normalize the body every time the user
   * clicked into the rich tab.
   */
  applyRich(doc: JSONContent): void {
    this.dirty = true;
    this.serialized = toMarkdown(doc);
  }

  /** The markdown to store. Unchanged bytes until the rich side edits. */
  get text(): string {
    return this.dirty && this.serialized !== null ? this.serialized : this.original;
  }

  get isRichDirty(): boolean {
    return this.dirty;
  }
}

/* ------------------------------------------------------------------ *
 * markdown → TipTap JSON
 * ------------------------------------------------------------------ */

/**
 * A list-item line: leading indentation, a bullet (`-`/`*`/`+`) or ordinal
 * (`\d+.`/`\d+)`), then the item text. The indent group drives nesting and
 * the ordinal group carries the list's `start`.
 */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Column width of a line's leading whitespace (a tab counts as one). */
function indentOf(line: string): number {
  return (/^(\s*)/.exec(line)?.[1] ?? "").length;
}

/**
 * Parses one list — every consecutive item at exactly `indent` columns —
 * into a `bulletList`/`orderedList` node, recursing on any deeper-indented
 * run beneath an item to build nested lists. Returns the node and the next
 * unconsumed line.
 *
 * A change of marker family (bullet ↔ ordinal) at the same indent ends the
 * list, matching the flat parser's old behaviour. An ordered list records
 * its first item's ordinal as `start`; `toMarkdown` counts up from it, so
 * `3.`/`4.` survives instead of being renumbered to `1.`/`2.`.
 */
function parseList(
  lines: readonly string[],
  start: number,
  indent: number,
): { node: JSONContent; next: number } {
  const first = LIST_ITEM_RE.exec(lines[start] ?? "");
  const ordered = /\d/.test(first?.[2] ?? "");
  const startNum = ordered ? Number(/\d+/.exec(first?.[2] ?? "0")?.[0] ?? "1") : undefined;
  const items: JSONContent[] = [];
  let i = start;

  while (i < lines.length) {
    const m = LIST_ITEM_RE.exec(lines[i] ?? "");
    if (!m) break;
    if (indentOf(lines[i] ?? "") !== indent) break;
    if (/\d/.test(m[2] ?? "") !== ordered) break;

    let text = m[3] ?? "";
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    const attrs = task ? { checked: (task[1] ?? " ").toLowerCase() === "x" } : undefined;
    if (task) text = task[2] ?? "";

    const itemContent: JSONContent[] = [
      { type: "paragraph", content: inlineNodes(text) },
    ];
    i++;

    // A deeper-indented list-item run directly below becomes a nested list
    // on this item.
    if (i < lines.length) {
      const next = LIST_ITEM_RE.exec(lines[i] ?? "");
      if (next && indentOf(lines[i] ?? "") > indent) {
        const nested = parseList(lines, i, indentOf(lines[i] ?? ""));
        itemContent.push(nested.node);
        i = nested.next;
      }
    }

    items.push({
      type: "listItem",
      ...(attrs ? { attrs } : {}),
      content: itemContent,
    });
  }

  const node: JSONContent = {
    type: ordered ? "orderedList" : "bulletList",
    ...(ordered && startNum !== undefined && startNum !== 1
      ? { attrs: { start: startNum } }
      : {}),
    content: items,
  };
  return { node, next: i };
}

/**
 * Parses markdown into a TipTap document.
 *
 * Deliberately a block-level parser with inline handling, not a
 * CommonMark implementation. It covers what the toolbar can produce
 * (TSK-18) plus LocTT's own extensions, and anything it does not
 * recognise becomes a paragraph of literal text rather than being
 * dropped — the failure mode is "shown as source", never "silently
 * deleted", which is the invariant `findLossyConstructs` exists to
 * back up server-side.
 */
export function fromMarkdown(md: string): JSONContent {
  // Normalise CRLF/CR line endings first. Without this a `\r` rides on the
  // end of every line, and the block regexes (which end in `(.*)$` — `.`
  // does not match `\r`) fail to recognise a heading/list on a `\r`-suffixed
  // line, while the paragraph loop's break-test (`/^(#{1,6})\s/`, no `$`)
  // still fires — so the loop breaks without advancing `i` and spins
  // forever. A pasted Windows heading/list (text/plain is CRLF) hit this.
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const content: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code. The info string is carried through verbatim so a
    // line-highlight fence (```ts {3,5-7}) survives — dropping it
    // would quietly change what the renderer shows.
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const [, , marker, info] = fence;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker?.[0] ?? "`"}{3,}\\s*$`).test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // closing fence
      content.push({
        type: "codeBlock",
        attrs: { language: (info ?? "").trim() || null },
        ...(body.length > 0 ? { content: [{ type: "text", text: body.join("\n") }] } : {}),
      });
      continue;
    }

    // Block math: $$ … $$
    if (/^\s*\$\$\s*$/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++;
      content.push({ type: "blockMath", attrs: { expr: body.join("\n") } });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // ATX heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1]?.length ?? 1 },
        content: inlineNodes(heading[2] ?? ""),
      });
      i++;
      continue;
    }

    // Thematic break
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Blockquote — consecutive `>` lines are one quote.
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      const inner = fromMarkdown(quoted.join("\n"));
      content.push({ type: "blockquote", content: inner.content ?? [] });
      continue;
    }

    // GFM pipe table (TSK-66). A header row of `| a | b |`, a delimiter
    // row of `| --- | :--: |`, then zero or more body rows. Recognised as
    // a table only when the delimiter row is present — a lone `| a | b |`
    // line with no `---` beneath is not a table, and forcing it into one
    // would swallow ordinary text that merely contains pipes. When it is a
    // table, the cells become editable `tableHeader`/`tableCell` nodes
    // rather than the literal paragraph text the case forbids.
    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i);
      content.push(table.node);
      i = table.next;
      continue;
    }

    // Lists. Task-list items are a bullet list with `checked` attrs, so
    // `- [x] done` does not degrade into the literal text "[x] done".
    // Nesting is by leading indentation (LIST_ITEM_RE captures it): a run
    // of items at one indent is a list, and a deeper-indented run beneath
    // an item becomes a nested list on that item, recursively. Ordered
    // lists carry their first ordinal as `start` so `3.\n4.` is not
    // renumbered to `1.\n2.` on a rich edit.
    if (LIST_ITEM_RE.test(line)) {
      const parsed = parseList(lines, i, indentOf(line));
      content.push(parsed.node);
      i = parsed.next;
      continue;
    }

    // Paragraph: consecutive non-blank lines that start no other block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.trim() === "") break;
      if (/^(#{1,6})\s/.test(l) || /^\s*>/.test(l) || LIST_ITEM_RE.test(l)) break;
      if (/^(\s*)(`{3,}|~{3,})/.test(l)) break;
      if (isTableStart(lines, i)) break;
      para.push(l);
      i++;
    }
    if (para.length === 0) {
      // Defence in depth: if the current line tripped a break-test but no
      // block handler above consumed it, the loop would spin without
      // advancing. Consume the line as a literal paragraph rather than
      // hang. (With CRLF now normalised this should be unreachable.)
      content.push({ type: "paragraph", content: inlineNodes(lines[i] ?? "") });
      i++;
      continue;
    }
    content.push({ type: "paragraph", content: inlineNodes(para.join("\n")) });
  }

  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/* ------------------------------------------------------------------ *
 * GFM pipe tables (TSK-66)
 * ------------------------------------------------------------------ */

/**
 * A GFM delimiter row: `| --- | :--: | ---: |`. Each cell is a run of
 * dashes with an optional leading and/or trailing colon (alignment).
 * The row is what distinguishes a table from a paragraph that merely
 * contains pipes, so the test is deliberately strict.
 */
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A line that carries at least one unescaped pipe — a candidate row. */
function isTableRow(line: string): boolean {
  return /(?:^|[^\\])\|/.test(line);
}

/**
 * True when line `i` begins a GFM pipe table: a header row followed by a
 * delimiter row. Both are required — a lone piped line is not a table.
 */
function isTableStart(lines: readonly string[], i: number): boolean {
  const header = lines[i] ?? "";
  const delim = lines[i + 1] ?? "";
  return isTableRow(header) && TABLE_DELIM_RE.test(delim) && delim.includes("-");
}

/**
 * Splits a pipe-table row into its cell texts.
 *
 * Leading and trailing pipes are optional in GFM and are stripped. A
 * backslash-escaped pipe (`\|`) is a literal inside a cell, not a
 * separator, so the split honours the escape and the cell keeps the raw
 * `\|` — re-serialization emits it back unchanged.
 */
function splitCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let j = 0; j < trimmed.length; j++) {
    const ch = trimmed[j];
    if (ch === "\\" && trimmed[j + 1] === "|") {
      current += "\\|";
      j++;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parses the table starting at line `i` into a TipTap `table` node and
 * reports the next unconsumed line. The first row becomes `tableHeader`
 * cells; the delimiter row is consumed and dropped (alignment is not
 * preserved as a node attr — GFM alignment has no TipTap-cell home, and
 * a rich edit re-emits a plain `---` delimiter, which is the documented
 * cost of editing in rich mode); subsequent piped rows become
 * `tableCell` rows until a non-row line.
 */
function parseTable(
  lines: readonly string[],
  start: number,
): { node: JSONContent; next: number } {
  const header = splitCells(lines[start] ?? "");
  const columns = header.length;
  let i = start + 2; // skip header + delimiter
  const bodyRows: string[][] = [];
  while (i < lines.length && isTableRow(lines[i] ?? "") && (lines[i] ?? "").trim() !== "") {
    bodyRows.push(splitCells(lines[i] ?? ""));
    i++;
  }

  const cell = (text: string, kind: "tableHeader" | "tableCell"): JSONContent => ({
    type: kind,
    content: [{ type: "paragraph", content: inlineNodes(text) }],
  });

  const rows: JSONContent[] = [
    { type: "tableRow", content: header.map(c => cell(c, "tableHeader")) },
  ];
  for (const row of bodyRows) {
    // Pad or trim to the header's column count so the grid is rectangular
    // — a malformed row with too few/many cells does not desync the table.
    const padded = Array.from({ length: columns }, (_, c) => row[c] ?? "");
    rows.push({ type: "tableRow", content: padded.map(c => cell(c, "tableCell")) });
  }

  return { node: { type: "table", content: rows }, next: i };
}

/**
 * Inline parsing: marks, mentions, math, attachment embeds.
 *
 * Order matters. Code spans are taken first and their contents are not
 * scanned further — `` `**not bold**` `` must stay literal, and a
 * mention inside a code span is documentation rather than a mention
 * (the same rule core's `extractMentions` applies, deliberately).
 * `~~strike~~` is taken before `~sub~` because the single-tilde
 * pattern would otherwise match the first two characters of a
 * strikethrough and turn every one of them into a subscript — the
 * exact conflation `extensions.ts` warns about.
 */
function inlineNodes(text: string): JSONContent[] {
  if (text === "") return [];
  const out: JSONContent[] = [];

  // Each alternative is ordered longest-delimiter-first for the same
  // reason `~~` precedes `~`.
  const pattern = new RegExp(
    [
      // 1 backslash escape — TAKEN FIRST so an escaped delimiter (`\*`,
      // `\_`, `` \` ``, `\\`) is consumed as one literal character and can
      // never be seen as an emphasis/code opener afterwards. CommonMark
      // escape semantics: a backslash before an ASCII punctuation char
      // makes that char literal and the backslash is dropped on render.
      // The escaped char keeps an `mdEscape` mark so `toMarkdown` re-emits
      // it in its `\x` form and the round-trip is stable.
      "\\\\([!-/:-@\\[-`{-~])", // 1 escaped punctuation
      "(`+)([\\s\\S]*?)\\2", // 2 (fence), 3 code span
      "!\\[\\[([^\\]]+)\\]\\]", // 4 file embed
      "!\\[([^\\]]*)\\]\\(([^)]+)\\)", // 5,6 image/attachment embed
      "\\[([^\\]]+)\\]\\(([^)]+)\\)", // 7,8 link
      "\\*\\*([\\s\\S]+?)\\*\\*", // 9 bold
      // 10 bold, 13 italic — underscore emphasis only at word boundaries.
      // CommonMark: an underscore *inside* a word does not open or close
      // emphasis, so `snake_case`, `my_var_name` and `a_b_c` stay literal
      // instead of being read as emphasis and re-serialized with `*`
      // (the prose-corruption bug). The `(?<!\w)`/`(?!\w)` guards require a
      // non-word char (or string edge) on the outer side of each delimiter.
      "(?<!\\w)__([\\s\\S]+?)__(?!\\w)", // 10 bold
      "~~([\\s\\S]+?)~~", // 11 strike
      // 12 italic — asterisk emphasis with a space+digit flanking guard.
      // Without a guard `5 * 3 * 2` parsed to italic ` 3 ` and RENDERED
      // italic where the user wrote arithmetic. The guard is a scoped
      // subset of CommonMark flanking: the opening `*` must be followed by
      // a non-space and not be preceded by a digit; the closing `*` must be
      // preceded by a non-space and not be followed by a digit. This keeps
      // whitespace-flanked (` * `) and digit-adjacent (`5*3`) asterisks
      // literal while still recognising `*real italic*`. Full punctuation
      // flanking is deliberately out of scope (see A245).
      "(?<!\\d)\\*(?=\\S)([\\s\\S]+?)(?<=\\S)\\*(?!\\d)", // 12 italic
      "(?<!\\w)_([\\s\\S]+?)_(?!\\w)", // 13 italic
      "\\$([^$\\n]+?)\\$", // 14 inline math
      "\\^([^^\\s]+)\\^", // 15 superscript
      "~([^~\\s]+)~", // 16 subscript
      "@user:([A-Za-z0-9_-]+)", // 17 mention
    ].join("|"),
    "g",
  );

  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index;
    if (at === undefined) continue;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    last = at + m[0].length;

    if (m[1] !== undefined) {
      // Escaped punctuation: render the bare char, tag it so it re-escapes.
      out.push({ type: "text", text: m[1], marks: [{ type: "mdEscape" }] });
    } else if (m[3] !== undefined) {
      out.push({ type: "text", text: m[3], marks: [{ type: "code" }] });
    } else if (m[4] !== undefined) {
      out.push({ type: "attachmentEmbed", attrs: { src: m[4], alt: "" } });
    } else if (m[6] !== undefined) {
      out.push({ type: "attachmentEmbed", attrs: { src: m[6], alt: m[5] ?? "" } });
    } else if (m[8] !== undefined) {
      out.push({
        type: "text",
        text: m[7] ?? "",
        marks: [{ type: "link", attrs: { href: m[8] } }],
      });
    } else if (m[9] !== undefined || m[10] !== undefined) {
      out.push(...marked(m[9] ?? m[10] ?? "", "bold"));
    } else if (m[11] !== undefined) {
      out.push(...marked(m[11], "strike"));
    } else if (m[12] !== undefined || m[13] !== undefined) {
      out.push(...marked(m[12] ?? m[13] ?? "", "italic"));
    } else if (m[14] !== undefined) {
      out.push({ type: "inlineMath", attrs: { expr: m[14] } });
    } else if (m[15] !== undefined) {
      out.push(...marked(m[15], "superscript"));
    } else if (m[16] !== undefined) {
      out.push(...marked(m[16], "subscript"));
    } else if (m[17] !== undefined) {
      out.push({ type: "mention", attrs: { userId: m[17] } });
    }
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Applies one mark to nested inline content. */
function marked(text: string, mark: string): JSONContent[] {
  return inlineNodes(text).map(n =>
    n.type === "text"
      ? { ...n, marks: [...(n.marks ?? []), { type: mark }] }
      : n,
  );
}

/* ------------------------------------------------------------------ *
 * TipTap → markdown
 * ------------------------------------------------------------------ */

/**
 * Serializes a TipTap document back to markdown.
 *
 * Reached **only** after a real edit in the visual editor — see
 * `RichBuffer`. Its spellings are therefore the ones a rich-mode edit
 * normalizes to, and they are chosen to match what the on-disk syntax
 * table in `docs/dev/reference/markdown-extensions.md` documents, so a body
 * written by an agent following that table survives a rich edit
 * unchanged in the parts the user did not touch.
 */
export function toMarkdown(doc: JSONContent): string {
  const blocks = (doc.content ?? []).map(n => block(n)).filter(b => b !== "");
  const text = blocks.join("\n\n");
  return text === "" ? "" : text + "\n";
}

/**
 * Reads one string attribute off a node.
 *
 * TipTap types `attrs` as `Record<string, any>`, so every read is
 * genuinely unknown at compile time. Narrowing to `string` here rather
 * than `String()`-ing at each call site is the difference between an
 * attribute that went missing rendering as `""` and it rendering as
 * the literal text `[object Object]` inside the user's markdown.
 */
function attr(node: JSONContent, name: string): string {
  const v = (node.attrs as Record<string, unknown> | undefined)?.[name];
  return typeof v === "string" ? v : "";
}

function block(node: JSONContent, depth = 0): string {
  switch (node.type) {
    case "paragraph":
      return inlineText(node.content ?? []);
    case "heading": {
      const level = Number((node.attrs as { level?: unknown } | undefined)?.level ?? 1);
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${inlineText(node.content ?? [])}`;
    }
    case "codeBlock": {
      const lang = (node.attrs as { language?: unknown } | undefined)?.language;
      const body = (node.content ?? []).map(c => c.text ?? "").join("");
      return "```" + (typeof lang === "string" ? lang : "") + "\n" + body + "\n```";
    }
    case "blockMath":
      return "$$\n" + attr(node, "expr") + "\n$$";
    case "horizontalRule":
      return "---";
    case "blockquote":
      return (node.content ?? [])
        .map(c => block(c, depth))
        .join("\n\n")
        .split("\n")
        .map(l => (l === "" ? ">" : `> ${l}`))
        .join("\n");
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const pad = "  ".repeat(depth);
      // Honour an ordered list's `start` so `3.`/`4.` is not renumbered to
      // `1.`/`2.`; count up from it. A bullet list uses `-`.
      const startRaw = (node.attrs as { start?: unknown } | undefined)?.start;
      const start = ordered && typeof startRaw === "number" && Number.isFinite(startRaw)
        ? startRaw
        : 1;
      return (node.content ?? [])
        .map((item, idx) => {
          const marker = ordered ? `${start + idx}.` : "-";
          const checked = (item.attrs as { checked?: unknown } | undefined)?.checked;
          const box = checked === true ? "[x] " : checked === false ? "[ ] " : "";
          // Split the item's own leaf blocks (paragraphs) from any nested
          // lists: the leaf text sits on the marker line, a nested list is
          // emitted on its own following lines at depth+1 (its own `pad`
          // handles the indentation), joined by a single newline so the
          // list stays tight.
          const children = item.content ?? [];
          const leaf = children.filter(c => c.type !== "bulletList" && c.type !== "orderedList");
          const nested = children.filter(c => c.type === "bulletList" || c.type === "orderedList");
          const leafText = leaf.map(c => block(c, depth + 1)).join("\n\n");
          const nestedText = nested.map(c => block(c, depth + 1)).join("\n");
          const head = `${pad}${marker} ${box}${leafText}`;
          return nestedText === "" ? head : `${head}\n${nestedText}`;
        })
        .join("\n");
    }
    case "table":
      return tableToMarkdown(node);
    case "attachmentEmbed":
      return `![${attr(node, "alt")}](${attr(node, "src")})`;
    default:
      return inlineText(node.content ?? []);
  }
}

/**
 * Serializes a `table` node back to a GFM pipe table (TSK-66).
 *
 * The first `tableRow` is emitted as the header, followed by a delimiter
 * row of plain `---` per column, then the remaining rows as body cells.
 * Cells are single-line: a hard break inside a cell becomes a space,
 * because a GFM pipe-table cell cannot contain a literal newline without
 * breaking the row. Column count is taken from the header so the
 * delimiter always matches, even if a body row has a different length.
 *
 * This is the *edited* path only (see `RichBuffer`): an unedited body
 * with a table returns its original bytes untouched. So a table the user
 * merely looked at is never rewritten; only a table they actually edited
 * is re-emitted in this canonical spelling, which is the documented cost
 * of rich-mode editing (A14).
 */
function tableToMarkdown(node: JSONContent): string {
  const rows = (node.content ?? []).filter(r => r.type === "tableRow");
  if (rows.length === 0) return "";
  const cellsOf = (row: JSONContent): string[] =>
    (row.content ?? []).map(cellNode => {
      const inner = (cellNode.content ?? [])
        .map(c => inlineText(c.content ?? []))
        .join(" ")
        .replace(/\n/g, " ")
        .trim();
      // A literal pipe inside a cell must be escaped or it reads as a
      // column separator on the next parse. Normalise first (drop any
      // existing backslash before a pipe) then escape EVERY pipe, so the
      // result is exactly one `\|` per pipe — a lookbehind-style
      // "only a bare pipe" replace skipped the second of two adjacent
      // pipes (`a||b`), leaving it to re-parse as a column break, and
      // could not be fixed by a single non-overlapping global match.
      return inner.replace(/\\\|/g, "|").replace(/\|/g, "\\|");
    });

  const header = cellsOf(rows[0] as JSONContent);
  const columns = header.length;
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: columns }, (_, c) => cells[c] ?? "").join(" | ")} |`;

  const out: string[] = [line(header)];
  out.push(`| ${Array.from({ length: columns }, () => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) out.push(line(cellsOf(row)));
  return out.join("\n");
}

/**
 * Serializes inline content.
 *
 * Marks are emitted innermost-last so nesting reads the way an author
 * would write it (`**bold with *emphasis* inside**`), and the order is
 * fixed rather than following the mark array's order — otherwise the
 * same document serializes two ways depending on the order the user
 * happened to click the toolbar buttons, and a save would differ from
 * the one before it with no edit between them.
 */
const MARK_WRAPPERS: readonly (readonly [string, string, string])[] = [
  ["code", "`", "`"],
  ["bold", "**", "**"],
  ["italic", "*", "*"],
  ["strike", "~~", "~~"],
  ["superscript", "^", "^"],
  ["subscript", "~", "~"],
];

function inlineText(nodes: readonly JSONContent[]): string {
  return nodes
    .map(n => {
      if (n.type === "mention") return `@user:${attr(n, "userId")}`;
      if (n.type === "inlineMath") return `$${attr(n, "expr")}$`;
      if (n.type === "attachmentEmbed") {
        return `![${attr(n, "alt")}](${attr(n, "src")})`;
      }
      if (n.type === "hardBreak") return "\n";
      let text = n.text ?? "";
      const marks = n.marks ?? [];
      // A char that arrived as a backslash escape (`mdEscape`) re-emits in
      // its `\x` form so it stays literal on the next parse — otherwise a
      // `*` that the user escaped would round-trip back into an emphasis
      // delimiter. No other markup wraps an escaped char.
      if (marks.some(mk => mk.type === "mdEscape")) {
        return text.replace(/([!-/:-@[-`{-~])/g, "\\$1");
      }
      // A link wraps whatever the character marks produced, so it is
      // applied last — `[**bold**](url)`, not `**[bold](url)**`.
      for (const [name, open, close] of MARK_WRAPPERS) {
        if (marks.some(mk => mk.type === name)) text = `${open}${text}${close}`;
      }
      const link = marks.find(mk => mk.type === "link");
      if (link) {
        const href = (link.attrs as Record<string, unknown> | undefined)?.["href"];
        text = `[${text}](${typeof href === "string" ? href : ""})`;
      }
      return text;
    })
    .join("");
}
