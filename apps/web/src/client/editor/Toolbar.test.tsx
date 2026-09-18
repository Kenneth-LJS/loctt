// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown, toMarkdown } from "./markdown.ts";
import { Toolbar } from "./Toolbar.tsx";

/**
 * The B3 toolbar (K-7). The picker and the block-transform commands are
 * tested against a real editor, because what they assert is
 * editor-state behaviour: which level the picker reflects, and where the
 * caret lands after a transform (TSK-59 / TSK-60).
 *
 * A note on the trailing paragraph. StarterKit ships `TrailingNode`,
 * which keeps one empty block after the last heading so a user can click
 * below a heading and keep typing. So a document whose only content is a
 * heading legitimately has two children — the heading and that trailing
 * paragraph. TSK-60's "does not accumulate trailing empty blocks" is
 * therefore about the count *staying constant* across repeated toggles,
 * not about it being one.
 */

let editor: Editor | null = null;

/** Puts the caret inside the first block (a real edit position). */
function caretInFirstBlock(e: Editor): void {
  e.commands.setTextSelection(2);
}

beforeEach(() => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      ...LOCTT_EXTENSIONS,
    ],
    content: fromMarkdown("A plain paragraph.\n"),
  });
  caretInFirstBlock(editor);
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
});

function ed(): Editor {
  if (editor === null) throw new Error("no editor");
  return editor;
}

describe("Toolbar level picker — TSK-59", () => {
  // @verifies TSK-59
  it("offers Paragraph and H1–H6", () => {
    render(<Toolbar editor={ed()} />);
    const picker = screen.getByTestId<HTMLSelectElement>("fmt-block-type");
    const options = Array.from(picker.options).map(o => o.textContent);
    expect(options).toEqual([
      "Paragraph", "Heading 1", "Heading 2", "Heading 3",
      "Heading 4", "Heading 5", "Heading 6",
    ]);
  });

  // @verifies TSK-59
  it("serialises every picked level as `#`×level and parses it back", () => {
    // The round-trip the case pins: setHeading(level) → `#`×level in
    // markdown → fromMarkdown recovers that same level.
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      ed().chain().focus().setHeading({ level }).run();
      const md = toMarkdown(ed().getJSON());
      expect(md.startsWith(`${"#".repeat(level)} A plain paragraph.`)).toBe(true);
      const round = fromMarkdown(md);
      expect(round.content?.[0]?.attrs?.["level"]).toBe(level);
    }
  });

  // @verifies TSK-59
  it("reflects the current block's level in the picker", () => {
    ed().chain().focus().setHeading({ level: 3 }).run();
    render(<Toolbar editor={ed()} />);
    expect((screen.getByTestId<HTMLSelectElement>("fmt-block-type")).value).toBe("3");

    cleanup();
    ed().chain().focus().setParagraph().run();
    render(<Toolbar editor={ed()} />);
    expect((screen.getByTestId<HTMLSelectElement>("fmt-block-type")).value).toBe("paragraph");
  });
});

describe("Toolbar block transform caret — TSK-60", () => {
  /** Picks a value in the level picker, driving `applyBlock`. */
  function pick(value: string): void {
    fireEvent.change(screen.getByTestId("fmt-block-type"), { target: { value } });
  }

  // @verifies TSK-60
  it("leaves the caret in the transformed block, reflected immediately by the picker", () => {
    render(<Toolbar editor={ed()} />);
    pick("2");
    // The caret sits in the heading, so the editor reports it active and
    // the picker — reading the same state — shows Heading 2 at once.
    expect(ed().isActive("heading", { level: 2 })).toBe(true);
    expect((screen.getByTestId<HTMLSelectElement>("fmt-block-type")).value).toBe("2");
  });

  // @verifies TSK-60
  it("re-picking the same level is idempotent, not a toggle back to paragraph", () => {
    render(<Toolbar editor={ed()} />);
    pick("2");
    expect(ed().isActive("heading", { level: 2 })).toBe(true);
    // Picking Heading 2 again must NOT turn it back into a paragraph —
    // the failure a `toggleHeading` picker would produce, and the source
    // of the "trailing empty blocks" the case warns about.
    pick("2");
    expect(ed().isActive("heading", { level: 2 })).toBe(true);
  });

  // @verifies TSK-60
  it("does not accumulate trailing empty blocks under repeated picks", () => {
    render(<Toolbar editor={ed()} />);
    pick("2");
    const baseline = ed().state.doc.childCount;

    for (let i = 0; i < 5; i++) {
      pick("paragraph");
      pick("2");
    }
    // The block count settles after the first transform (heading +
    // TrailingNode's empty paragraph) and must not grow per toggle.
    expect(ed().state.doc.childCount).toBe(baseline);
  });
});

describe("Toolbar buttons — TSK-61 / TSK-65", () => {
  // @verifies TSK-61
  it("has an ordered-list button that creates a list round-tripping to `1.`", () => {
    render(<Toolbar editor={ed()} />);
    expect(screen.getByTestId("fmt-orderedList").tagName).toBe("BUTTON");

    ed().chain().focus().toggleOrderedList().run();
    expect(ed().isActive("orderedList")).toBe(true);
    expect(toMarkdown(ed().getJSON())).toBe("1. A plain paragraph.\n");
  });

  // @verifies TSK-65
  it("exposes strikethrough / superscript / subscript buttons that toggle real marks", () => {
    render(<Toolbar editor={ed()} />);
    expect(screen.getByTestId("fmt-strike").tagName).toBe("BUTTON");
    expect(screen.getByTestId("fmt-superscript").tagName).toBe("BUTTON");
    expect(screen.getByTestId("fmt-subscript").tagName).toBe("BUTTON");

    ed().chain().focus().selectAll().toggleStrike().run();
    expect(ed().isActive("strike")).toBe(true);
    ed().chain().focus().selectAll().toggleStrike().run();

    ed().chain().focus().selectAll().toggleMark("superscript").run();
    expect(ed().isActive("superscript")).toBe(true);
    ed().chain().focus().selectAll().toggleMark("superscript").run();

    ed().chain().focus().selectAll().toggleMark("subscript").run();
    expect(ed().isActive("subscript")).toBe(true);
  });
});
