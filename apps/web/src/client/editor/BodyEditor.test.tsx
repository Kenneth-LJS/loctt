// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftKey } from "./bodyDraft.ts";
import type { BodyAutosave, BodyAutosaveOptions, SaveState } from "./useBodyAutosave.ts";

/**
 * `BodyEditor`'s orchestration (K33 read-then-edit; K124 Save/Cancel).
 *
 * `BodyEditor`'s job is the state machine: rendered by default, an
 * explicit Edit button (A247) to enter edit, Save to write and close,
 * Cancel/Escape to discard (asking first when there are changes),
 * click-away to do nothing, and STAY in edit on a failed save. The
 * heavy children and the save hook are mocked so this asserts the
 * orchestration only; `BodyEditor.leave-race.test.tsx` mounts the real
 * hook, and the hook has its own tests.
 *
 * SUPERSEDED (K124, Ken 2026-09-24): this file used to assert K96 —
 * "Escape flushes and returns to the rendered view, keeping the text",
 * "Cmd/Ctrl+Enter flushes and leaves" — and TSK-71's "blurring out of
 * the editor flushes and returns to the rendered view". All three were
 * green and encoded the save-on-exit behaviour Ken ruled out; they are
 * rewritten below to the new behaviour.
 */

const save = vi.fn(async () => {});
const cancel = vi.fn();
const flushDraft = vi.fn();
let currentState: SaveState = { kind: "saved" };
let currentConflict: BodyAutosave["conflict"] = null;
let lastOptions: BodyAutosaveOptions | null = null;

vi.mock("./useBodyAutosave.ts", () => ({
  useBodyAutosave: (opts: BodyAutosaveOptions): BodyAutosave => {
    lastOptions = opts;
    return {
      state: currentState,
      conflict: currentConflict,
      edit: vi.fn(),
      save,
      retry: vi.fn(async () => {}),
      flushDraft,
      resolve: vi.fn(async () => {}),
      dismissConflict: vi.fn(),
      cancel,
      hasUnsavedWork:
        currentState.kind === "unsaved" || currentState.kind === "failed" || currentConflict !== null,
    };
  },
}));

// The router guard needs a RouterProvider this bare render lacks; its
// own tests drive a real router. Here it is captured so the test can
// play the router's part and ask the editor to decide a navigation.
let guard: { hasUnsavedWork: boolean; onNavigateAway: () => Promise<boolean> } | null = null;
vi.mock("../router/useUnsavedGuard.ts", () => ({
  useUnsavedGuard: (g: { hasUnsavedWork: boolean; onNavigateAway: () => Promise<boolean> }): void => {
    guard = g;
  },
}));

vi.mock("./RichEditor.tsx", () => ({
  RichEditor: ({ markdown }: { markdown: string }) => (
    <div data-testid="rich-editor" tabIndex={0}>{markdown}</div>
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

const TASK_ID = "01TESTTASK000000000000000C";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
beforeEach(() => {
  save.mockClear();
  cancel.mockClear();
  flushDraft.mockClear();
  currentState = { kind: "saved" };
  currentConflict = null;
  lastOptions = null;
  guard = null;
});

function editorElement(body = "Some body text.") {
  return (
    <BodyEditor
      taskId={TASK_ID}
      taskRef="WEB-7"
      body={body}
      bodyToken="tok-1"
      lossyConstructs={[]}
      mentionCandidates={[]}
    />
  );
}

function renderEditor(body = "Some body text.") {
  return render(editorElement(body));
}

function enterEdit(): void {
  fireEvent.click(screen.getByTestId("body-edit"));
}

function pressIn(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { screen.getByTestId("rich-editor").dispatchEvent(ev); });
  return ev;
}

describe("BodyEditor — K33 two-state orchestration", () => {
  // @verifies TSK-68
  it("TSK-68: renders read-only by default — no toolbar, no editable field", () => {
    renderEditor();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
    expect(screen.queryByTestId("mode-rich")).toBeNull();
    expect(screen.queryByTestId("mode-raw")).toBeNull();
    expect(screen.queryByTestId("body-save")).toBeNull();
    expect(screen.getByTestId("body-editor")).toBeTruthy();
  });

  // @verifies A247
  it("A247: clicking the Edit button mounts the editor with the mode toggle", () => {
    renderEditor();
    enterEdit();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.getByTestId("mode-rich")).toBeTruthy();
    expect(screen.getByTestId("mode-raw")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
  });

  // @verifies TSK-69
  it("TSK-69: the raw/markdown toggle switches surfaces inside edit mode", () => {
    renderEditor();
    enterEdit();
    fireEvent.click(screen.getByTestId("mode-raw"));
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });

  it("aligns the edit surface flush-left too, so entering edit does not shift the text horizontally", () => {
    renderEditor();
    enterEdit();
    expect(screen.getByTestId("body-editor").className).toContain("-mx-3");
  });

  // @verifies K33
  it("K33: the toolbar (with the mode toggle) is shown at once on entering edit, not focus-gated", () => {
    renderEditor();
    enterEdit();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByTestId("mode-rich")).toBeTruthy();
    expect(screen.getByTestId("mode-raw")).toBeTruthy();
  });
});

describe("BodyEditor — K124 Save and Cancel", () => {
  // @verifies TSK-15
  it("Save is disabled with no changes and enabled once there are", () => {
    const view = renderEditor();
    enterEdit();
    expect(screen.getByTestId("body-save").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("body-cancel")).toBeTruthy();

    currentState = { kind: "unsaved" };
    view.rerender(editorElement());
    expect(screen.getByTestId("body-save").hasAttribute("disabled")).toBe(false);
  });

  // @verifies TSK-15
  it("Save writes, shows its loading state, and returns to the rendered view once the write lands", () => {
    currentState = { kind: "unsaved" };
    const view = renderEditor();
    enterEdit();

    fireEvent.click(screen.getByTestId("body-save"));
    expect(save).toHaveBeenCalledTimes(1);
    // Still editing: the write has not landed.
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    currentState = { kind: "saving" };
    view.rerender(editorElement());
    const busy = screen.getByTestId("body-save");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-label")).toBe("Save");
    expect(screen.getByTestId("rich-editor")).toBeTruthy();

    currentState = { kind: "saved" };
    view.rerender(editorElement());
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });

  // @verifies TSK-48
  it("TSK-48: a failed save keeps the editor open on the unsaved text, not a stale render", () => {
    currentState = { kind: "unsaved" };
    const view = renderEditor();
    enterEdit();
    fireEvent.click(screen.getByTestId("body-save"));
    expect(save).toHaveBeenCalled();

    currentState = { kind: "failed", message: "not saved" };
    view.rerender(editorElement());
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    // Save stays available as the retry.
    expect(screen.getByTestId("body-save").hasAttribute("disabled")).toBe(false);
  });

  // @verifies TSK-15
  it("Cmd/Ctrl+Enter and Cmd/Ctrl+S save, and the key never reaches the rich surface", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();

    const surfaceSaw = vi.fn();
    screen.getByTestId("rich-editor").addEventListener("keydown", surfaceSaw);
    const enter = pressIn("Enter", { metaKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    // Captured above the surface: the rich editor's own Mod-Enter (a hard
    // break) must not add a line to the text being saved.
    expect(surfaceSaw).not.toHaveBeenCalled();

    pressIn("s", { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(2);
  });

  // @verifies TSK-15
  it("Cmd/Ctrl+Enter with no changes closes without writing", () => {
    renderEditor();
    enterEdit();
    pressIn("Enter", { ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });

  // @verifies TSK-71
  // SUPERSEDED: this was "TSK-71: blurring out of the editor flushes and
  // returns to the rendered view". K124: click-away neither saves nor
  // discards.
  it("clicking away keeps edit mode: nothing is saved or discarded, only the draft is kept", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    screen.getByTestId("rich-editor").focus();

    act(() => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: null });
    });

    expect(save).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(flushDraft).toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
  });

  // @verifies TSK-59
  it("TSK-59: focus moving into a PORTALLED dropdown panel does not close the editor", () => {
    renderEditor();
    enterEdit();
    screen.getByTestId("rich-editor").focus();
    const panel = document.createElement("div");
    panel.setAttribute("data-portal-panel", "");
    const row = document.createElement("button");
    panel.appendChild(row);
    document.body.appendChild(panel);

    act(() => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: row });
    });

    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    document.body.removeChild(panel);
  });

  // @verifies TSK-71
  // SUPERSEDED: this was "K96: Escape flushes and returns to the rendered
  // view, keeping the text". K124: Escape is Cancel.
  it("Escape with no changes closes at once, without asking and without writing", () => {
    renderEditor();
    enterEdit();
    pressIn("Escape");
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });

  // @verifies TSK-71
  it("Escape with changes asks 'Discard changes?'; Keep editing keeps everything", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    pressIn("Escape");

    const dialog = screen.getByRole("dialog", { name: "Discard changes?" });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId("body-discard-confirm").textContent).toBe("Discard");
    expect(screen.getByTestId("body-discard-keep").textContent).toBe("Keep editing");
    // No reasoning text: title and two actions only (messaging.md).
    expect(screen.getByTestId("body-discard-dialog").textContent).toBe("Keep editingDiscard");
    // The draft is flushed before asking, so a tab that dies here keeps it.
    expect(flushDraft).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("body-discard-keep"));
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
  });

  // @verifies TSK-71
  it("confirming Discard drops the changes and returns to the rendered view, writing nothing", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    fireEvent.click(screen.getByTestId("body-cancel"));

    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("body-discard-confirm"));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
  });

  // @verifies TSK-71
  it("Escape in the discard prompt keeps editing rather than re-opening the prompt", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    pressIn("Escape");
    expect(screen.getByTestId("body-discard-dialog")).toBeTruthy();

    act(() => {
      screen.getByTestId("body-discard-keep")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
  });

  // @verifies TSK-71
  it("Escape the rich surface already handled (ProseMirror prevents every Escape) still prompts", () => {
    // prosemirror-view's `captureKeyDown` calls preventDefault on every
    // keyCode-27 keydown, so by the time Escape bubbles out of the rich
    // editor its default is always prevented. Found live: a
    // `defaultPrevented` gate made Escape do nothing in the rich editor.
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    const surface = screen.getByTestId("rich-editor");
    surface.addEventListener("keydown", e => { e.preventDefault(); });
    pressIn("Escape", { keyCode: 27 });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
  });

  it("Escape while the conflict dialog is open does NOT prompt or leave", () => {
    currentState = { kind: "failed", message: "changed" };
    currentConflict = { mine: "m", theirs: "t", theirToken: "tok-2" };
    renderEditor();
    enterEdit();
    pressIn("Escape");
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape while a menu/picker panel is open belongs to the panel", () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();
    const panel = document.createElement("div");
    panel.setAttribute("data-portal-panel", "");
    document.body.appendChild(panel);

    pressIn("Escape");
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    document.body.removeChild(panel);
  });
});

describe("BodyEditor — K124 leaving the page", () => {
  // @verifies TSK-48
  it("arms the navigation guard only while there are unsaved changes", () => {
    const view = renderEditor();
    enterEdit();
    expect(guard?.hasUnsavedWork).toBe(false);
    currentState = { kind: "unsaved" };
    view.rerender(editorElement());
    expect(guard?.hasUnsavedWork).toBe(true);
  });

  // @verifies TSK-40
  it("a navigation asks the same question: Discard lets it through and drops the changes", async () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();

    let decided: Promise<boolean> = Promise.resolve(false);
    act(() => { decided = guard?.onNavigateAway() ?? decided; });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("body-discard-confirm"));
    await expect(decided).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  // @verifies TSK-40
  it("Keep editing blocks the navigation and leaves the edit untouched", async () => {
    currentState = { kind: "unsaved" };
    renderEditor();
    enterEdit();

    let decided: Promise<boolean> = Promise.resolve(true);
    act(() => { decided = guard?.onNavigateAway() ?? decided; });
    fireEvent.click(screen.getByTestId("body-discard-keep"));
    await expect(decided).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("rich-editor")).toBeTruthy();
  });
});

describe("BodyEditor — A338 draft restore", () => {
  // @verifies TSK-73
  it("a draft for this task reopens straight into edit mode on the draft text", () => {
    const draft = { text: "Restored draft words.", baseToken: "tok-1", baseBody: "Some body text." };
    window.sessionStorage.setItem(draftKey(TASK_ID), JSON.stringify(draft));
    currentState = { kind: "unsaved" };
    renderEditor();

    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(screen.getByTestId("rich-editor").textContent).toBe("Restored draft words.");
    expect(lastOptions?.initialDraft).toEqual(draft);
  });

  // @verifies TSK-73
  it("a draft identical to the body on disk is dropped and the read view shows", () => {
    window.sessionStorage.setItem(draftKey(TASK_ID), JSON.stringify({
      text: "Some body text.", baseToken: "tok-0", baseBody: "older",
    }));
    renderEditor();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
    expect(window.sessionStorage.getItem(draftKey(TASK_ID))).toBeNull();
  });

  // @verifies TSK-73
  it("another task's draft does not open this task's editor", () => {
    window.sessionStorage.setItem(draftKey("01OTHERTASK00000000000000Z"), JSON.stringify({
      text: "not mine", baseToken: "tok-1", baseBody: "Some body text.",
    }));
    renderEditor();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });
});
