// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown, toMarkdown } from "./markdown.ts";
import { useMentionState } from "./MentionMenu.tsx";
import { RichEditor } from "./RichEditor.tsx";

/**
 * G14 / CMT-7: a mention in the editor was an empty, zero-width span, so
 * the composer showed nothing where the user went, and a click to the
 * right of the line put the caret before it — the next words landed in
 * front of the mention and the stored body (`…look@user:<id>`) no longer
 * read as a mention.
 */

afterEach(cleanup);

const noop = (): void => {};
const ANA = { id: "01ANA000000000000000000000", name: "Ana Lopez" };

describe("mention chip in the editor", () => {
  // @verifies CMT-7
  it("shows the user's name, not an empty span", () => {
    render(
      <RichEditor markdown={`cc @user:${ANA.id}`} onDocChange={noop} onBlur={noop} mentionCandidates={[ANA]} />,
    );
    const chip = screen.getByTestId("editor-mention");
    expect(chip.textContent).toBe("@Ana Lopez");
    expect(chip.getAttribute("data-mention-id")).toBe(ANA.id);
  });

  it("repaints when the user list arrives after the body", () => {
    const { rerender } = render(
      <RichEditor markdown={`cc @user:${ANA.id}`} onDocChange={noop} onBlur={noop} mentionCandidates={[]} />,
    );
    expect(screen.getByTestId("editor-mention").textContent).toBe(`@user:${ANA.id}`);
    rerender(
      <RichEditor markdown={`cc @user:${ANA.id}`} onDocChange={noop} onBlur={noop} mentionCandidates={[ANA]} />,
    );
    expect(screen.getByTestId("editor-mention").textContent).toBe("@Ana Lopez");
  });

  it("falls back to the stored token for a user it does not know, as the rendered view does", () => {
    render(
      <RichEditor markdown="cc @user:01NOBODY0000000000000000000" onDocChange={noop} onBlur={noop} mentionCandidates={[ANA]} />,
    );
    expect(screen.getByTestId("editor-mention").textContent).toBe("@user:01NOBODY0000000000000000000");
  });
});

describe("choosing a mention", () => {
  // @verifies CMT-7
  it("leaves text after the mention, so what is typed next follows it", () => {
    const editor = new Editor({
      extensions: [StarterKit, ...LOCTT_EXTENSIONS],
      content: fromMarkdown("cc @a"),
    });
    editor.commands.focus("end");
    const { result } = renderHook(() => useMentionState(editor, [ANA]));
    // The hook reads the query on editor updates: type the query's last
    // character once it is listening.
    act(() => { editor.commands.insertContent("n"); });
    expect(result.current.open).toBe(true);

    act(() => { result.current.choose(ANA); });
    editor.commands.insertContent("please look");

    // A text node follows the mention, and the next words land in it.
    expect(toMarkdown(editor.getJSON()).trim()).toBe(`cc @user:${ANA.id} please look`);
    editor.destroy();
  });
});
