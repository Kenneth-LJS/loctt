import { describe, expect, it } from "vitest";

import { findLossyConstructs, requiresSourceMode } from "./lossy.js";

describe("findLossyConstructs", () => {
  describe("safe bodies", () => {
    it.each([
      ["plain prose", "Just some text."],
      ["headings and lists", "# Title\n\n- one\n- two"],
      ["bold, italic, strike", "**b** *i* ~~s~~"],
      ["task list", "- [ ] todo\n- [x] done"],
      ["gfm table", "| a | b |\n|---|---|\n| 1 | 2 |"],
      ["fenced code", "```ts\nconst x = 1;\n```"],
      ["inline katex", "Euler: $e^{i\\pi}+1=0$"],
      ["block katex", "$$\n\\int_0^1 x\\,dx\n$$"],
      ["superscript / subscript", "x^2^ and H~2~O"],
      ["mention", "cc @user:01J0000000000000000000000"],
      ["attachment embed", "![diagram](attachments/arch.png)"],
      ["task reference", "blocked by T-123"],
      ["empty body", ""],
    ])("%s is editable visually", (_label, body) => {
      expect(findLossyConstructs(body)).toEqual([]);
      expect(requiresSourceMode(body)).toBe(false);
    });

    it("allows HTML tags that map to a TipTap node", () => {
      // These round-trip, so forcing source mode would be a false alarm.
      expect(requiresSourceMode("<strong>bold</strong> and <sup>up</sup>")).toBe(false);
    });
  });

  describe("footnotes", () => {
    it("reports a definition", () => {
      const found = findLossyConstructs("Text.\n\n[^1]: the note");
      expect(found).toHaveLength(1);
      expect(found[0]?.kind).toBe("footnote");
      expect(found[0]?.line).toBe(3);
    });

    it("reports a reference", () => {
      const found = findLossyConstructs("A claim[^1] here.");
      expect(found[0]?.kind).toBe("footnote");
      expect(found[0]?.line).toBe(1);
    });
  });

  describe("raw HTML", () => {
    it("reports an unregistered tag", () => {
      const found = findLossyConstructs("<div class='x'>content</div>");
      expect(found).toHaveLength(1);
      expect(found[0]?.kind).toBe("raw_html");
      expect(found[0]?.excerpt).toContain("div");
    });

    it("reports closing tags too", () => {
      expect(requiresSourceMode("</section>")).toBe(true);
    });

    it("reports an unknown tag rather than assuming it is safe", () => {
      // Allowlist, not blocklist: a tag nobody anticipated must fail
      // closed, because the alternative is silently destroying it.
      expect(requiresSourceMode("<custom-element>x</custom-element>")).toBe(true);
    });

    it("reports at most once per line", () => {
      const found = findLossyConstructs("<div><span>a</span></div>");
      expect(found).toHaveLength(1);
    });
  });

  describe("code is not markup", () => {
    it("ignores HTML inside a fenced block", () => {
      // A body documenting HTML must stay visually editable.
      const body = "Example:\n\n```html\n<div>hi</div>\n```\n";
      expect(findLossyConstructs(body)).toEqual([]);
    });

    it("ignores HTML inside an inline code span", () => {
      expect(requiresSourceMode("Use the `<div>` element.")).toBe(false);
    });

    it("ignores a footnote-looking string inside a fence", () => {
      expect(requiresSourceMode("```\n[^1]: not a footnote here\n```")).toBe(false);
    });

    it("resumes detection after the fence closes", () => {
      const body = "```\n<div>ignored</div>\n```\n\n<div>caught</div>";
      const found = findLossyConstructs(body);
      expect(found).toHaveLength(1);
      expect(found[0]?.line).toBe(5);
    });

    it("handles tilde fences", () => {
      expect(requiresSourceMode("~~~\n<div>x</div>\n~~~")).toBe(false);
    });

    it("does not let a tilde fence close a backtick fence", () => {
      // Mismatched markers would end the fence early and start
      // reporting sample content as real markup.
      const body = "```\n~~~\n<div>still inside</div>\n```";
      expect(findLossyConstructs(body)).toEqual([]);
    });
  });

  it("reports several constructs with their lines", () => {
    const body = "A[^1]\n\n<div>x</div>\n\n[^1]: note";
    const found = findLossyConstructs(body);
    expect(found.map(f => `${f.kind}:${f.line}`)).toEqual([
      "footnote:1", "raw_html:3", "footnote:5",
    ]);
  });
});
