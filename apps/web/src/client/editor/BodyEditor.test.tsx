// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BodyAutosave, SaveState } from "./useBodyAutosave.ts";

/**
 * The K33 two-state orchestration in `BodyEditor` (TSK-68/69/71/48).
 *
 * `BodyEditor`'s job is the state machine: rendered by default, click
 * to enter edit, blur/Escape to leave, and STAY in edit on a failed
 * save. The heavy children (`RichEditor`, `MarkdownEditor`, the
 * autosave hook that hits the network) are mocked so this test asserts
 * the orchestration and nothing else — the real editor and the real
 * save flow are exercised by the e2e spec and their own unit tests.
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
    resolve: vi.fn(async () => {}),
    dismissConflict: vi.fn(),
    cancel,
    hasUnsavedWork: false,
  }),
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

  // @verifies TSK-69
  it("TSK-69: clicking the rendered text mounts the editor with the mode toggle", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Some body text."));

    // The editor and the raw/rich toggle appear — and only here.
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.getByTestId("mode-rich")).toBeTruthy();
    expect(screen.getByTestId("mode-raw")).toBeTruthy();
    // The read view is gone.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
  });

  // @verifies TSK-71
  it("TSK-71: Escape cancels the edit and returns to the rendered view", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Some body text."));
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    // Back to rendered; Escape is a cancel, so it does not flush.
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
    expect(flush).not.toHaveBeenCalled();
  });

  // @verifies TSK-71
  it("TSK-71: blurring out of the editor flushes and returns to the rendered view", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Some body text."));
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

  // @verifies TSK-48
  it("TSK-48: a failed save keeps the editor open on the unsaved text, not a stale render", () => {
    currentState = { kind: "failed", message: "not saved" };
    renderEditor();
    fireEvent.click(screen.getByText("Some body text."));
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
    fireEvent.click(screen.getByText("Some body text."));
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mode-raw"));
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });
});
