// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown } from "./markdown.ts";
import {
  EMPTY_PLACEHOLDER,
  insertMarkdownAsSlice,
  looksLikeMarkdown,
  RichEditor,
} from "./RichEditor.tsx";

/**
 * The B3 editor lane (K-7 / K-7b). Two kinds of test live here:
 *
 *  - The *paste* behaviour (TSK-63) is a document transform, exercised
 *    against a real ProseMirror `Editor` built with the same extension
 *    set `RichEditor` mounts. A jsdom paste event does not carry usable
 *    `clipboardData`, so the handler's parse-and-insert *transform* is
 *    what is asserted, not the browser's event plumbing (the e2e spec
 *    covers the real paste).
 *  - The *rendering* behaviour (TSK-62 placeholder, TSK-64 toolbar
 *    collapse, TSK-67 test-id) is asserted by rendering the component.
 */

afterEach(cleanup);

const noop = (): void => {};

/**
 * Builds an editor with the exact extension set `RichEditor` mounts, so
 * a command that succeeds here succeeds there. If that config drifts,
 * these tests stop describing the real editor — the same caveat
 * `mentionCode.test.ts` carries.
 */
function makeEditor(content = ""): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder: EMPTY_PLACEHOLDER }),
      Link.configure({ openOnClick: false, autolink: false }),
      ...LOCTT_EXTENSIONS,
    ],
    content: fromMarkdown(content),
  });
}

describe("RichEditor paste — TSK-63", () => {
  // @verifies TSK-63
  it("parses pasted markdown into a heading and a list, not literal text", () => {
    const editor = makeEditor("");
    // The exact function the `handlePaste` handler calls.
    insertMarkdownAsSlice(editor.view, "# Heading\n\n- item\n- item");

    const json = editor.getJSON();
    const types = (json.content ?? []).map(n => n.type);
    // A heading node and a bullet list — NOT three paragraphs of the
    // literal characters "# Heading", "- item", "- item".
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");

    const heading = (json.content ?? []).find(n => n.type === "heading");
    expect(heading?.attrs?.["level"]).toBe(1);
    const firstInline = heading?.content?.[0] as { text?: string } | undefined;
    expect(firstInline?.text).toBe("Heading");

    const list = (json.content ?? []).find(n => n.type === "bulletList");
    expect(list?.content).toHaveLength(2);

    // The failure the case names: the literal "#" must not survive as
    // text anywhere in the document.
    expect(JSON.stringify(json)).not.toContain("# Heading");
    editor.destroy();
  });

  // @verifies TSK-63
  it("diverts markdown pastes but leaves plain prose to the default handler", () => {
    // The guard the handler consults before diverting: block markdown is
    // parsed, ordinary prose is not (so a pasted paragraph is not
    // re-flowed).
    expect(looksLikeMarkdown("# Heading\n\n- item\n- item")).toBe(true);
    expect(looksLikeMarkdown("- a list")).toBe(true);
    expect(looksLikeMarkdown("1. numbered")).toBe(true);
    expect(looksLikeMarkdown("just a sentence, with a comma")).toBe(false);
    expect(looksLikeMarkdown("two\nlines of prose")).toBe(false);
    // Prose with ONE stray marker line among non-marker lines is not a
    // list (fix-review: these re-flowed on paste before the multi-line
    // guard). A single-line marker still diverts (above).
    expect(looksLikeMarkdown("Seed: v1\n+ 40 cases")).toBe(false);
    expect(looksLikeMarkdown("Price went up 5%.\n> 3 people agreed")).toBe(false);
    expect(looksLikeMarkdown("Options:\n1) apples")).toBe(false);
    // …but a real multi-item list still diverts.
    expect(looksLikeMarkdown("- one\n- two")).toBe(true);
    expect(looksLikeMarkdown("> quote line one\n> quote line two")).toBe(true);
  });
});

describe("RichEditor rendering", () => {
  // @verifies TSK-62
  it("shows the raw editor's placeholder copy for an empty body", () => {
    // The two surfaces must not disagree about the empty-state copy.
    expect(EMPTY_PLACEHOLDER).toBe("Describe this task…");

    render(<RichEditor markdown="" onDocChange={noop} onBlur={noop} mentionCandidates={[]} />);
    const surface = screen.getByTestId("rich-editor");
    // ProseMirror-Placeholder renders the copy via CSS `::before` fed by
    // this attribute; jsdom cannot read pseudo-content, so the attribute
    // is what proves the placeholder is wired.
    const empty = surface.querySelector("[data-placeholder]");
    expect(empty?.getAttribute("data-placeholder")).toBe("Describe this task…");
  });

  // @verifies TSK-64
  it("collapses the toolbar in view mode", () => {
    render(<RichEditor markdown="hello" onDocChange={noop} onBlur={noop} mentionCandidates={[]} />);
    // Merely viewing: no formatting toolbar, and so no format button in
    // any state — the case's "no format button renders active while
    // merely viewing" is satisfied by there being no format button.
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    expect(screen.queryByTestId("fmt-bold")).toBeNull();
    expect(screen.queryByTestId("fmt-block-type")).toBeNull();
  });

  // @verifies TSK-64
  it("reveals the toolbar once the surface is focused", async () => {
    render(<RichEditor markdown="hello" onDocChange={noop} onBlur={noop} mentionCandidates={[]} />);
    const surface = screen.getByTestId("rich-editor");
    // Focus is tracked at the wrapper via React's onFocus, which maps to
    // the bubbling `focusin` event. A bubbling `focusin` on the surface
    // is what reaches the wrapper. `.focus()` is avoided because it runs
    // ProseMirror's selection→scroll path, which reaches `getClientRects`
    // (absent in jsdom) and throws an unhandled error that masks real
    // failures.
    await act(async () => {
      surface.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
    });
    expect(screen.getByRole("toolbar", { name: "Formatting" }).getAttribute("aria-label"))
      .toBe("Formatting");
  });

  // @verifies TSK-67
  it("puts the caller's test-id on the surface, defaulting to rich-editor", () => {
    const { rerender } = render(
      <RichEditor markdown="" onDocChange={noop} onBlur={noop} mentionCandidates={[]} />,
    );
    expect(screen.getByTestId("rich-editor").getAttribute("data-testid")).toBe("rich-editor");

    rerender(
      <RichEditor
        markdown=""
        onDocChange={noop}
        onBlur={noop}
        mentionCandidates={[]}
        testId="comment-composer-rich-editor"
      />,
    );
    expect(screen.getByTestId("comment-composer-rich-editor")).toBeDefined();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });
});
