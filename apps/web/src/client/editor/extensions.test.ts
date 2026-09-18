import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";

/**
 * These assert the schema actually registers each node, which is what
 * decides whether TipTap keeps or drops the content. A node that is
 * declared but not reachable from the schema drops silently on save —
 * the exact failure B5 exists to prevent.
 */
describe("LocTT TipTap extensions", () => {
  const schema = getSchema([StarterKit, ...LOCTT_EXTENSIONS]);

  it.each(["inlineMath", "blockMath", "mention", "attachmentEmbed"])(
    "registers the %s node",
    name => {
      expect(schema.nodes[name]).toBeDefined();
    },
  );

  it.each(["superscript", "subscript"])("registers the %s mark", name => {
    expect(schema.marks[name]).toBeDefined();
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
});
