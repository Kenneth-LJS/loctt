import type { JSONContent } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown, toMarkdown } from "./markdown.ts";

/**
 * These assert the schema actually registers each node, which is what
 * decides whether TipTap keeps or drops the content. A node that is
 * declared but not reachable from the schema drops silently on save —
 * the exact failure B5 exists to prevent.
 */
describe("LocTT TipTap extensions", () => {
  // Configured exactly as `RichEditor` configures it. `underline: false`
  // matters (K107): StarterKit ships an underline mark of the same name
  // that parses/renders `<u>`, so a schema built without that flag tests
  // a configuration the app does not use — and `registers the underline
  // mark` would pass on StarterKit's mark even with ours deleted.
  const schema = getSchema([
    StarterKit.configure({ link: false, underline: false }),
    ...LOCTT_EXTENSIONS,
  ]);

  it.each(["inlineMath", "blockMath", "mention", "attachmentEmbed"])(
    "registers the %s node",
    name => {
      expect(schema.nodes[name]).toBeDefined();
    },
  );

  it.each(["superscript", "subscript"])("registers the %s mark", name => {
    expect(schema.marks[name]).toBeDefined();
  });

  // @verifies K107
  it.each(["underline", "highlight"])("registers the %s mark", name => {
    // Unregistered marks are DROPPED by the schema, so a mark that
    // parses and serializes correctly still loses the user's formatting
    // the moment the doc routes through TipTap. Remove Underline /
    // Highlight from LOCTT_EXTENSIONS and this goes red.
    expect(schema.marks[name]).toBeDefined();
  });

  // @verifies K107
  it("survives the schema round trip for <ins> and ==, keeping both marks", () => {
    // The step markdown.test.ts cannot cover: it never routes the doc
    // through ProseMirror. This does, which is where an unregistered
    // mark silently vanishes.
    const md = "A <ins>under</ins> and ==lit== b";
    const roundTripped = schema.nodeFromJSON(fromMarkdown(md)).toJSON() as JSONContent;
    expect(toMarkdown(roundTripped).trimEnd()).toBe(md);
  });

  // @verifies K107
  it("parses <ins> to underline and <mark> to highlight, not to strike", () => {
    // The tags each mark claims must be the ones the on-disk syntax
    // uses, and must not collide with strike (which parses s/del/strike).
    expect(schema.marks["underline"]?.spec.parseDOM?.[0]?.tag).toBe("ins");
    expect(schema.marks["highlight"]?.spec.parseDOM?.[0]?.tag).toBe("mark");
    expect(schema.marks["underline"]).not.toBe(schema.marks["strike"]);
  });

  // @verifies K107
  it("never registers <u> as a way to underline", () => {
    // StarterKit's own underline mark parses `u` and renders `<u>`,
    // which GitHub strips silently. With `underline: false` the ONLY
    // underline mark in the schema is LocTT's `<ins>` one. Drop that
    // flag (in this file or RichEditor) and `u` reappears — red.
    const tags = (schema.marks["underline"]?.spec.parseDOM ?? [])
      .map(r => ("tag" in r ? r.tag : undefined));
    expect(tags).toContain("ins");
    expect(tags).not.toContain("u");
  });

  it("keeps subscript distinct from strikethrough", () => {
    // `~sub~` and `~~strike~~` are one character apart. Collapsing them
    // turns every subscript into a strikethrough on the next save.
    expect(schema.marks["subscript"]).toBeDefined();
    expect(schema.marks["strike"]).toBeDefined();
    expect(schema.marks["subscript"]).not.toBe(schema.marks["strike"]);
  });

  it("makes math and mentions atomic", () => {
    // Atomic means the payload is edited as one unit, so ordinary
    // typing cannot leave an expression half-delimited.
    for (const name of ["inlineMath", "blockMath", "mention", "attachmentEmbed"]) {
      expect(schema.nodes[name]?.spec.atom).toBe(true);
    }
  });

  it("keeps attachment embeds distinct from images", () => {
    // The same syntax carries images, video and audio, dispatched by
    // MIME at render time. A generic image node would rewrite a video
    // embed into an <img> on save.
    expect(schema.nodes["attachmentEmbed"]).toBeDefined();
    expect(schema.nodes["attachmentEmbed"]).not.toBe(schema.nodes["image"]);
  });

  it.each(["table", "tableRow", "tableHeader", "tableCell"])(
    "registers the %s node so a GFM pipe table is not dropped (TSK-66)",
    name => {
      // @verifies TSK-66
      // Without these four nodes in the schema, TipTap drops a pasted or
      // loaded pipe table — the paragraph-text failure the case forbids.
      // Removing them from LOCTT_EXTENSIONS turns this red.
      expect(schema.nodes[name]).toBeDefined();
    },
  );

  // A task-list item's `checked` state must survive the ProseMirror schema.
  // markdown.ts parses `- [x]` into a listItem with attrs.checked and
  // serializes it back, but StarterKit's listItem declares no such
  // attribute, so without TaskItemAttr the schema drops it on the first
  // rich edit — every checkbox is silently erased and re-serialized as a
  // plain bullet. Removing TaskItemAttr from LOCTT_EXTENSIONS turns these
  // red (verified). markdown.test.ts's parse/serialize cases pass without
  // the fix because they never route the doc through the schema.
  describe("task-list checked attribute survives the schema", () => {
    it("keeps `checked` on a listItem round-tripped through nodeFromJSON", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                attrs: { checked: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
              },
              {
                type: "listItem",
                attrs: { checked: false },
                content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }],
              },
            ],
          },
        ],
      };
      // Route through the schema exactly as the editor does, then read the
      // attrs back off the reconstructed node.
      const node = schema.nodeFromJSON(doc);
      const json = node.toJSON() as typeof doc;
      const items = json.content[0]?.content ?? [];
      expect((items[0] as { attrs?: { checked?: unknown } }).attrs?.checked).toBe(true);
      expect((items[1] as { attrs?: { checked?: unknown } }).attrs?.checked).toBe(false);
    });

    it("preserves `[x]`/`[ ]` across fromMarkdown → schema → toMarkdown", () => {
      const md = "- [x] done\n- [ ] todo";
      // fromMarkdown → through the schema (the step that dropped it) → back.
      // toMarkdown appends a trailing newline; trim for the comparison.
      const roundTripped = schema.nodeFromJSON(fromMarkdown(md)).toJSON() as JSONContent;
      expect(toMarkdown(roundTripped).trimEnd()).toBe(md);
    });

    it("leaves a plain bullet as a plain bullet (no phantom checkbox)", () => {
      const md = "- plain item";
      const roundTripped = schema.nodeFromJSON(fromMarkdown(md)).toJSON() as JSONContent;
      expect(toMarkdown(roundTripped).trimEnd()).toBe(md);
    });
  });
});
