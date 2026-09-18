// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { inCodeContext, mentionQuery } from "./MentionMenu.tsx";

/**
 * CMT-7's fourth bullet: "typing a `@` inside a code span or fenced
 * block does not trigger the picker."
 *
 * `mentionQuery` alone cannot decide this. It sees the forty
 * characters before the caret, and a fence that opened five lines up
 * is not among them — so the rule has to be asked of the *document*.
 * That is `inCodeContext`, and testing it needs a real ProseMirror
 * document rather than a string, which is why this is a separate file
 * from `MentionMenu.test.ts`.
 *
 * The rule matches core's own: `codeSpans` in `comments.ts` refuses to
 * read a mention inside code, so a picker firing there would insert a
 * token core will never read back — the user sees a mention and nobody
 * is notified.
 */

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(html: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), ...LOCTT_EXTENSIONS],
    content: html,
  });
  return editor;
}

/**
 * Puts the caret at the end of the document.
 *
 * Uses `setTextSelection`, NOT `focus("end")`. `focus` moves the real
 * DOM selection, and ProseMirror's focus path schedules a 50ms
 * `setTimeout` (a selection-reset in prosemirror-view) that, in the
 * full parallel suite, fires *after* vitest tears down this file's
 * jsdom environment — throwing an uncaught `document is not defined`
 * from `DOMObserver`/`selectionToDOM` that failed the whole web run
 * intermittently. `inCodeContext` reads `editor.state.selection`, not
 * DOM focus, so a selection transaction gives the identical caret with
 * no stray timer to outlive teardown.
 */
function caretAtEnd(ed: Editor): void {
  ed.commands.setTextSelection(ed.state.doc.content.size);
}

describe("inCodeContext", () => {
  /** @verifies CMT-7 */
  it("is false in ordinary prose, so the picker can fire there", () => {
    const ed = open("<p>ping @</p>");
    caretAtEnd(ed);

    // The paired positive, and the one that makes every negative below
    // mean something: a guard that always returned true would satisfy
    // them all.
    expect(inCodeContext(ed)).toBe(false);
    expect(mentionQuery("ping @")).toBe("");
  });

  /** @verifies CMT-7 */
  it("is true inside a fenced code block, however far the fence opened above", () => {
    const ed = open("<pre><code>line one\nline two\nline three @</code></pre>");
    caretAtEnd(ed);

    expect(inCodeContext(ed)).toBe(true);
    // And the text rule *would* have fired here — which is exactly why
    // the document-level check is needed rather than a longer regex.
    expect(mentionQuery("line three @")).toBe("");
  });

  /** @verifies CMT-7 */
  it("is true inside an inline code span, and false again just past it", () => {
    const ed = open("<p>see <code>@</code></p>");
    caretAtEnd(ed);
    expect(inCodeContext(ed)).toBe(true);

    // Past the span, the picker is available again — so this is
    // "suppressed inside code", not "suppressed once a code span
    // exists anywhere in the comment".
    const after = open("<p>see <code>x</code> then @</p>");
    caretAtEnd(after);
    expect(inCodeContext(after)).toBe(false);
  });
});
