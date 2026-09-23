import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
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
 * `<ins>text</ins>` — underline (K107).
 *
 * A custom mark rather than `@tiptap/extension-underline`, for two
 * reasons. The stock extension parses `u` and `span[style*=underline]`
 * and renders `<u>`; retargeting it at `<ins>` means overriding both
 * `parseHTML` and `renderHTML` — which is the entire extension — so the
 * dependency would buy only a keybinding, added below in four lines.
 * And `<u>` is the one spelling that must NOT reach disk: GitHub's
 * sanitiser allowlist omits `u` and strips it silently, so a stray
 * stock-extension render would cost the user their underline with no
 * warning. Owning the definition keeps `<ins>` the only spelling.
 *
 * `ins` semantically means *inserted text* (an edit-tracking mark), not
 * *underlined*. That stretch is deliberate and recorded in A251: it is
 * the only tag that is both on GitHub's allowlist and underlined by
 * every browser's UA stylesheet.
 */
export const Underline = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "ins" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", mergeAttributes(HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-u": () => this.editor.commands.toggleMark(this.name) };
  },
});

/**
 * `==text==` — highlight (K107).
 *
 * A markdown extension, not a tag, so unlike `<ins>` it needs no
 * `ALLOWED_HTML_TAGS` entry and cannot trip the lossy guardrail. Renders
 * as `<mark>`, which is what pandoc and Obsidian produce for the same
 * source spelling.
 */
export const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name) };
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
 * Persist the GFM task-list `checked` attribute on list items.
 *
 * `markdown.ts` parses `- [x] done` into a `listItem` whose `attrs.checked`
 * is `true`/`false`, and `toMarkdown` reads that attr back to write `[x]`/
 * `[ ]`. But StarterKit's `listItem` declares no `checked` attribute, so
 * ProseMirror's schema drops it on the first rich edit — every checkbox
 * state is silently erased and the item re-serializes as a plain bullet.
 *
 * `addGlobalAttributes` adds `checked` to the existing `listItem` node
 * (rather than replacing the node) so the attribute round-trips through an
 * edit. It renders as `data-checked` and parses back from it. `default:
 * null` means an ordinary (non-task) bullet carries no attr and still
 * serializes as a plain `-`, so only real task items get `[ ]`/`[x]`.
 */
export const TaskItemAttr = Extension.create({
  name: "taskItemAttr",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem"],
        attributes: {
          checked: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute("data-checked");
              return v === null ? null : v === "true";
            },
            renderHTML: (attrs: { checked?: boolean | null }) =>
              attrs.checked === null || attrs.checked === undefined
                ? {}
                : { "data-checked": String(attrs.checked) },
          },
        },
      },
    ];
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
  Underline,
  Highlight,
  InlineMath,
  BlockMath,
  Mention,
  AttachmentEmbed,
  TaskItemAttr,
  ...TABLE_EXTENSIONS,
] as const;
