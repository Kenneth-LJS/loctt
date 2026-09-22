// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BodyAutosave, SaveState } from "./useBodyAutosave.ts";

/**
 * The K33 two-state orchestration in `BodyEditor` (TSK-68/71/48; A247).
 *
 * `BodyEditor`'s job is the state machine: rendered by default, an
 * explicit Edit button (A247) to enter edit, blur/Escape to leave, and
 * STAY in edit on a failed save. The heavy children (`RichEditor`,
 * `MarkdownEditor`, the autosave hook that hits the network) are mocked
 * so this test asserts the orchestration and nothing else — the real
 * editor and the real save flow are exercised by the e2e spec and their
 * own unit tests. The router nav-guard (A246) is mocked too: it needs a
 * RouterProvider this bare render does not have, and its behaviour is
 * covered by `useUnsavedGuard`/`useBodyAutosave`'s own tests.
 */

// A mutable handle the mocked hook returns, so a test can drive the
// save state and observe flush calls.
const flush = vi.fn(async () => {});
const cancel = vi.fn();
let currentState: SaveState = { kind: "saved" };
let currentConflict: BodyAutosave["conflict"] = null;

vi.mock("./useBodyAutosave.ts", () => ({
  useBodyAutosave: (): BodyAutosave => ({
    state: currentState,
    conflict: currentConflict,
    edit: vi.fn(),
    flush,
    retry: vi.fn(async () => {}),
    flushForNav: vi.fn(() => Promise.resolve(true)),
    resolve: vi.fn(async () => {}),
    dismissConflict: vi.fn(),
    cancel,
    hasUnsavedWork: false,
  }),
}));

// The router nav-guard (A246) needs a RouterProvider this bare render
// lacks; its own tests cover it. Mock it to a no-op here.
vi.mock("../router/useUnsavedGuard.ts", () => ({
  useUnsavedGuard: (): void => {},
}));

// The rich surface: a focusable element carrying the id BodyEditor
// focuses and scopes to.
vi.mock("./RichEditor.tsx", () => ({
  RichEditor: ({ onBlur }: { onBlur: () => void }) => (
    <div data-testid="rich-editor" tabIndex={0} onBlur={onBlur}>
      rich
    </div>
  ),
}));

vi.mock("./MarkdownEditor.tsx", () => ({
  MarkdownEditor: () => <textarea data-testid="markdown-editor" />,
}));

vi.mock("./BodyConflictDialog.tsx", () => ({
  BodyConflictDialog: () => <div data-testid="body-conflict-dialog" />,
}));

// Imported after the mocks are registered.
const { BodyEditor } = await import("./BodyEditor.tsx");

afterEach(cleanup);
beforeEach(() => {
  flush.mockClear();
  currentState = { kind: "saved" };
  currentConflict = null;
});

function renderEditor(body = "Some body text.") {
  return render(
    <BodyEditor
      taskRef="WEB-7"
      body={body}
      bodyToken="tok-1"
      lossyConstructs={[]}
      mentionCandidates={[]}
    />,
  );
}

describe("BodyEditor — K33 two-state orchestration", () => {
  // @verifies TSK-68
  it("TSK-68: renders read-only by default — no toolbar, no editable field", () => {
    renderEditor();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    // The edit surface is not mounted in the read state.
    expect(screen.queryByTestId("rich-editor")).toBeNull();
    expect(screen.queryByTestId("mode-rich")).toBeNull();
    expect(screen.queryByTestId("mode-raw")).toBeNull();
    // The `body-editor` wrapper is present in the read state too.
    expect(screen.getByTestId("body-editor")).toBeTruthy();
  });

  // @verifies A247
  it("A247: clicking the Edit button mounts the editor with the mode toggle", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));

    // The editor and the raw/rich toggle appear — and only here.
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.getByTestId("mode-rich")).toBeTruthy();
    expect(screen.getByTestId("mode-raw")).toBeTruthy();
    // The read view is gone.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
  });

  // @verifies TSK-71
  // @verifies K96
  // NOTE: this replaces the former "Escape cancels ... does not flush"
  // assertion, which encoded the pre-K96 behaviour. Ken ruled (K96) the
  // editor has no discard gesture: Escape FLUSHES and leaves keeping the
  // text. The old test asserted the data-loss path (revert to last
  // autosave), so it was asserting the bug.
  it("K96: Escape flushes and returns to the rendered view, keeping the text", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // Escape now flushes (keep-the-text) and, once the save settles clean,
    // returns to the rendered view.
    expect(flush).toHaveBeenCalled();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });

  // @verifies K96
  it("K96: Cmd/Ctrl+Enter flushes and leaves, keeping the text", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    expect(flush).toHaveBeenCalled();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });

  // @verifies K96
  it("K96: Escape while the conflict dialog is open does NOT leave the editor", () => {
    currentConflict = { remoteToken: "tok-2", remoteBody: "theirs" } as unknown as BodyAutosave["conflict"];
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // The conflict owns Escape; the editor stays open and nothing is
    // flushed out from under the unresolved conflict.
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(flush).not.toHaveBeenCalled();
  });

  // @verifies TSK-71
  it("TSK-71: blurring out of the editor flushes and returns to the rendered view", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    const surface = screen.getByTestId("rich-editor");
    surface.focus();

    // Blur to somewhere outside the wrapper (relatedTarget null). The
    // blur sets `wantsLeave` and flushes; the `act` flushes the effect
    // that then returns to the rendered view.
    act(() => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: null });
    });

    expect(flush).toHaveBeenCalled();
    // A clean save returns to the rendered view.
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });

  // @verifies TSK-59
  it("TSK-59: focus moving into a PORTALLED dropdown panel is not a leave", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    const surface = screen.getByTestId("rich-editor");
    surface.focus();

    // The block-type picker is a `Dropdown`, whose panel is portalled to
    // `document.body` (MENU-PORTAL). So the panel is NOT a descendant of
    // the editor wrapper, and the old `wrapper.contains(relatedTarget)`
    // guard read "focus left the editor" — tearing the editor down the
    // moment the user opened the picker, so the transform never applied.
    const panel = document.createElement("div");
    panel.setAttribute("data-dropdown-panel", "");
    const row = document.createElement("button");
    panel.appendChild(row);
    document.body.appendChild(panel);

    act(() => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: row });
    });

    // The editor is STILL open — it did not flush or fall back to the
    // read view just because focus entered its own dropdown.
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();

    document.body.removeChild(panel);
  });

  // @verifies TSK-48
  it("TSK-48: a failed save keeps the editor open on the unsaved text, not a stale render", () => {
    currentState = { kind: "failed", message: "not saved" };
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    const surface = screen.getByTestId("rich-editor");
    surface.focus();

    act(() => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: null });
    });

    // Flush was attempted, but the editor stays open — no drop back to
    // the rendered read view over a failed write.
    expect(flush).toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
  });

  // @verifies TSK-69
  it("TSK-69: the raw/markdown toggle switches surfaces inside edit mode", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mode-raw"));
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });

  it("aligns the edit surface flush-left too, so entering edit does not shift the text horizontally", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    // The framed edit box mirrors the read view's `-mx-3` so its own px-3
    // content padding lands the text flush-left with the section label —
    // no horizontal jump between read and edit. Red-proof: without `-mx-3`
    // the framed box's border + padding indents the edit text past the
    // (now flush-left) read text.
    const box = screen.getByTestId("body-editor");
    expect(box.className).toContain("-mx-3");
  });

  // @verifies K33
  // The description toolbar is no longer focus-gated: entering edit shows
  // it immediately (formatting buttons + the mode toggle), so the user
  // does not have to focus the surface to see the controls. Red-proof: the
  // old behaviour rendered no toolbar/format buttons until focus, so
  // asserting them present right after entering edit fails against it.
  it("K33: the toolbar (with the mode toggle) is shown at once on entering edit, not focus-gated", () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("body-edit"));
    // The single always-visible toolbar and the mode toggle are present
    // the instant edit is entered — there is no focus gate any more. (The
    // formatting buttons populate once the real rich editor publishes its
    // instance to the toolbar; that path is covered by Toolbar.test and
    // RichEditor.test, where a real editor exists. RichEditor is mocked
    // here, so only the shell + toggle are asserted.)
    // Red-proof: entering edit here renders the toolbar without any focus
    // event; the pre-K33 gate showed no toolbar until focus.
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByTestId("mode-rich")).toBeTruthy();
    expect(screen.getByTestId("mode-raw")).toBeTruthy();
  });

});
