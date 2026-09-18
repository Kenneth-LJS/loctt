// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor.tsx";

afterEach(() => {
  cleanup();
});

/** The text CodeMirror currently holds, read from its rendered lines. */
function renderedDoc(): string {
  const lines = Array.from(document.querySelectorAll(".cm-line"));
  return lines.map((l) => l.textContent).join("\n");
}

/**
 * The live EditorView for the mounted editor. `EditorView.findFromDOM`
 * is CodeMirror's supported way in, so these tests drive the same
 * public surface the component does rather than test-only internals.
 */
function currentView(): EditorView {
  const root = document.querySelector<HTMLElement>(".cm-editor");
  if (root === null) throw new Error("no CodeMirror editor is mounted");
  const view = EditorView.findFromDOM(root);
  if (view === null) throw new Error("mounted DOM has no attached EditorView");
  return view;
}

describe("MarkdownEditor", () => {
  it("seeds the editor with the initial value", () => {
    render(<MarkdownEditor value="# Hello" onChange={vi.fn()} />);
    expect(renderedDoc()).toBe("# Hello");
  });

  it("syncs an external value change into the document", () => {
    const { rerender } = render(<MarkdownEditor value="first" onChange={vi.fn()} />);
    rerender(<MarkdownEditor value="second" onChange={vi.fn()} />);
    expect(renderedDoc()).toBe("second");
  });

  it("does not echo an external value change back through onChange", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="first" onChange={onChange} />);
    rerender(<MarkdownEditor value="second" onChange={onChange} />);
    // A parent driving `value` from its own state would loop forever if
    // the sync dispatch reported itself as a user edit.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onChange with the full document text when the user edits", () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="ab" onChange={onChange} />);
    act(() => {
      currentView().dispatch({ changes: { from: 2, insert: "c" } });
    });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("preserves the cursor across the controlled round trip", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="ab" onChange={onChange} />);

    // The user types: CodeMirror already holds "abc" and the caret sits
    // after the new character.
    act(() => {
      currentView().dispatch({ changes: { from: 2, insert: "c" }, selection: { anchor: 3 } });
    });
    expect(onChange).toHaveBeenCalledWith("abc");

    // The parent stores that text and feeds it back as a new prop
    // value. Naive syncing (recreating the view, or replacing the doc
    // without mapping the selection) collapses the caret to 0 — the
    // classic controlled-editor bug where typing jumps to the top.
    rerender(<MarkdownEditor value="abc" onChange={onChange} />);
    expect(renderedDoc()).toBe("abc");
    expect(currentView().state.selection.main.anchor).toBe(3);
  });

  it("re-renders without rebuilding the view, keeping undo history intact", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="x" onChange={onChange} />);
    const before = currentView();
    rerender(<MarkdownEditor value="x" onChange={() => undefined} />);
    expect(currentView()).toBe(before);
  });

  it("rejects edits while readOnly and accepts them once cleared", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor value="locked" onChange={onChange} readOnly />,
    );
    expect(currentView().state.readOnly).toBe(true);

    rerender(<MarkdownEditor value="locked" onChange={onChange} readOnly={false} />);
    expect(currentView().state.readOnly).toBe(false);
    // Toggling must reconfigure rather than remount, or the user loses
    // their document position every time the form flips to edit mode.
    expect(renderedDoc()).toBe("locked");
  });

  it("destroys the EditorView on unmount", () => {
    const { unmount } = render(<MarkdownEditor value="bye" onChange={vi.fn()} />);
    const view = currentView();
    // React detaches the host div either way, so DOM absence proves
    // nothing. `destroy()` is what releases CodeMirror's document
    // observers and global listeners — skipping it leaks one live
    // editor per visited task for the lifetime of the session.
    const destroy = vi.spyOn(view, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("applies the accessible name to the editing surface", () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} ariaLabel="Task body" />);
    expect(screen.getByLabelText("Task body").classList.contains("cm-content")).toBe(true);
  });
});
