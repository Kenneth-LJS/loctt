import { Mark, mergeAttributes, Node } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";

/**
 * TipTap nodes and marks for LocTT's own markdown extensions (B5).
 *
 * TipTap drops any node its schema does not recognise, so without
 * these, opening a body containing `$x$` or `^sup^` in visual mode and
 * saving it silently deletes the content. Registering them is what
 * keeps those constructs *editable* rather than merely detected —
 * `findLossyConstructs` in core deliberately does not report them,
 * because they round-trip through these definitions.
 *
 * Only footnotes and unregistered raw HTML have no node here, and
 * those are exactly what forces source mode.
 */

/** `^text^` — Pandoc-style superscript. */
export const Superscript = Mark.create({
  name: "superscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * `~text~` — Pandoc-style subscript.
 *
 * Single tilde, deliberately distinct from `~~strikethrough~~`. The
 * two are easy to conflate and a parser that treats them alike turns
 * every subscript into a strikethrough on the next save.
 */
export const Subscript = Mark.create({
  name: "subscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * Inline KaTeX: `$expr$`.
 *
 * Atomic: the expression is edited as one unit rather than as
 * characters inside a paragraph, so ordinary typing cannot leave it
 * half-delimited and unparseable.
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { expr: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-inline-math]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-inline-math": "" })];
  },
});

/** Block KaTeX: `$$\nexpr\n$$`. */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  addAttributes() {
    return { expr: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-block-math]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-math": "" })];
  },
});

/**
 * `@user:<id>` — a mention.
 *
 * The id is the payload; the display name is resolved at render time,
 * so a renamed user does not require rewriting every body that
 * mentions them.
 */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { userId: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-mention": "" })];
  },
});

/**
 * `![alt](attachments/<name>)` — an attachment embed.
 *
 * Distinct from a plain image because the renderer dispatches on MIME:
 * the same syntax carries images, video and audio. A generic image
 * node would rewrite a video embed into an `<img>` on save.
 */
export const AttachmentEmbed = Node.create({
  name: "attachmentEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "figure[data-attachment]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-attachment": "" })];
  },
});

/**
 * GFM pipe-table support (TSK-66).
 *
 * A GFM pipe table in the body must become a real, editable table node —
 * not literal paragraph text, and not a forced-raw fallback. The stock
 * TipTap table extensions (`@tiptap/extension-table`) register the four
 * nodes `table`/`tableRow`/`tableHeader`/`tableCell`; `markdown.ts`'s
 * `fromMarkdown`/`toMarkdown` are what map a GFM pipe table to and from
 * those nodes. Registering them here is what keeps a table *editable*
 * rather than dropped — the same reason the LocTT extensions above exist —
 * and is why `findLossyConstructs` deliberately does not report tables.
 *
 * `resizable` is left off: column-resize is a mouse affordance that adds
 * a `colwidth` attr with no GFM spelling, so it cannot round-trip to
 * markdown. The case asks only that a table renders and edits as a table,
 * not for pixel-width columns, so the affordance is scoped out to keep
 * the serialized markdown faithful.
 */
const TABLE_EXTENSIONS = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
] as const;

/** Every LocTT-specific extension, for registering with an editor. */
export const LOCTT_EXTENSIONS = [
  Superscript,
  Subscript,
  InlineMath,
  BlockMath,
  Mention,
  AttachmentEmbed,
  ...TABLE_EXTENSIONS,
] as const;
