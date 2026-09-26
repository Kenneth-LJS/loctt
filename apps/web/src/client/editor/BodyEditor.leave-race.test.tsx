// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftKey } from "./bodyDraft.ts";

/**
 * The save-then-leave race (TSK-48), with the REAL `useBodyAutosave`.
 *
 * The mocked-hook test in `BodyEditor.test.tsx` cannot see this bug: the
 * mock's `state` is whatever the test set, so there is no
 * `unsaved → saving` transition and no microtask gap to race against.
 *
 * ## The race
 *
 * `requestSave` sets "leave once the write lands" and calls `save()`.
 * `save` runs the network `write()` in a MICROTASK, and `write()` is what
 * moves the state to `saving` — so React can run the leave effect while
 * the state is STILL the pre-write `unsaved`. An effect that treated
 * that as "clean, safe to leave" unmounted the editor before the POST
 * started, and a failing save then landed on an unmounted component with
 * the user's text lost and no error shown. The effect leaves only on
 * `saved`.
 *
 * Originally written (fix-review HIGH #1) against the pre-K124
 * blur-save; K124 made Save the only write, so the trigger is now the
 * Save button and the same guarantee is asserted through it. The file
 * also covers, with the real hook, K124's "click-away writes nothing"
 * and A338's reload restore.
 */

// The deferred write: `fetch` records the call and hands back a promise
// the test resolves manually, so the leave-effect runs against a
// genuinely in-flight write.
interface Pending {
  readonly body: string;
  settle: (res: Response) => void;
}
let pending: Pending[] = [];

function installDeferredFetch(): void {
  pending = [];
  vi.stubGlobal("fetch", vi.fn((_url: string | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(raw) as { body: string };
    return new Promise<Response>(resolve => {
      pending.push({ body: parsed.body, settle: resolve });
    });
  }));
}

function failLast(): void {
  const p = pending.shift();
  if (p === undefined) throw new Error("no pending write to fail");
  p.settle(new Response(JSON.stringify({
    code: "io_failed",
    message: "No space left on device.",
    data_state: "not_saved",
    detail: "ENOSPC: no space left on device",
  }), { status: 500, headers: { "Content-Type": "application/json" } }));
}

// Real hook, mocked heavy children (same child mocks as BodyEditor.test.tsx).
// The markdown surface takes a plain string through `onChange`, so it
// drives `onRawChange` → `edit(next)` without needing a real TipTap doc.
vi.mock("./RichEditor.tsx", () => ({
  RichEditor: ({ onBlur }: { onBlur: () => void }) => (
    <div data-testid="rich-editor" tabIndex={0} onBlur={onBlur}>rich</div>
  ),
}));
vi.mock("./MarkdownEditor.tsx", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="markdown-editor"
      value={value}
      onChange={e => { onChange(e.target.value); }}
    />
  ),
}));
vi.mock("./BodyConflictDialog.tsx", () => ({
  BodyConflictDialog: () => <div data-testid="body-conflict-dialog" />,
}));

// The router nav-guard (A246) needs a RouterProvider this bare render
// lacks; this file is about the save-then-leave race, not in-app navigation,
// so mock the guard to a no-op. (Its own behaviour is covered by
// useUnsavedGuard/useBodyAutosave tests.)
vi.mock("../router/useUnsavedGuard.ts", () => ({
  useUnsavedGuard: (): void => {},
}));

// The REAL hook, with `cancel` counted. `cancel` refuses on its own
// while a write is in flight, so an Escape that reached it would leave no
// visible trace; the count is how the A346 test sees that Escape never
// got that far (A348).
const cancelCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("./useBodyAutosave.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useBodyAutosave.ts")>();
  return {
    ...actual,
    useBodyAutosave: (opts: Parameters<typeof actual.useBodyAutosave>[0]) => {
      const hook = actual.useBodyAutosave(opts);
      return {
        ...hook,
        cancel: () => { cancelCalls.count++; return hook.cancel(); },
      };
    },
  };
});

const { BodyEditor } = await import("./BodyEditor.tsx");

beforeEach(() => { installDeferredFetch(); window.sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TASK_ID = "01TESTTASK000000000000000D";

function renderEditor(
  body = "Some body text.",
  lossyConstructs: readonly { readonly kind: string; readonly line: number }[] = [],
) {
  return render(
    <BodyEditor
      taskId={TASK_ID}
      taskRef="WEB-7"
      body={body}
      bodyToken="tok-1"
      lossyConstructs={lossyConstructs}
      mentionCandidates={[]}
    />,
  );
}

// Enters edit, switches to the markdown surface, and types `typed`.
// Returns the textarea so the test can blur off it.
function markdownValue(): string {
  const el = screen.getByTestId("markdown-editor");
  return el instanceof HTMLTextAreaElement ? el.value : "";
}

async function enterEditAndType(): Promise<void> {
  fireEvent.click(screen.getByTestId("body-edit"));
  fireEvent.click(screen.getByTestId("mode-raw"));
  const textarea = screen.getByTestId("markdown-editor");
  textarea.focus();
  await act(async () => {
    fireEvent.change(textarea, { target: { value: "precious words the user typed" } });
    await Promise.resolve();
  });
}

function succeedLast(): void {
  const p = pending.shift();
  if (p === undefined) throw new Error("no pending write to settle");
  p.settle(new Response(JSON.stringify({ ok: true, bodyToken: "tok-2" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
}

describe("BodyEditor — save-then-leave race (TSK-48)", () => {
  // @verifies TSK-48
  it("a failing Save keeps the editor open and does NOT drop to the rendered view", async () => {
    renderEditor();
    await enterEditAndType();

    await act(async () => {
      fireEvent.click(screen.getByTestId("body-save"));
      await Promise.resolve();
    });

    // The write is genuinely in flight (deferred, not yet settled).
    expect(pending.length).toBe(1);
    expect(pending[0]?.body).toBe("precious words the user typed");

    // The editor must still be mounted while the write is pending.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();

    await act(async () => {
      failLast();
      await Promise.resolve();
    });

    // Editor still mounted, text retained, failure shown.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(markdownValue()).toBe("precious words the user typed");
    expect(screen.getByText(/No space left on device/)).toBeTruthy();
  });

  // @verifies TSK-15
  it("a Save that lands returns to the rendered view", async () => {
    renderEditor();
    await enterEditAndType();
    await act(async () => {
      fireEvent.click(screen.getByTestId("body-save"));
      await Promise.resolve();
    });
    await act(async () => {
      succeedLast();
      await Promise.resolve();
    });
    await waitFor(() => { expect(screen.getByTestId("body-rendered")).toBeTruthy(); });
  });
});

describe("BodyEditor — K124 with the real hook", () => {
  // @verifies TSK-71
  it("clicking away sends no write and keeps the editor open with the text", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderEditor();
    await enterEditAndType();

    await act(async () => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: null });
      // Well past the old idle-autosave window.
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(pending).toHaveLength(0);
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(markdownValue()).toBe("precious words the user typed");
    // The draft holds the text for this tab (A338).
    expect(window.sessionStorage.getItem(draftKey(TASK_ID))).toContain("precious words the user typed");
  });

  // @verifies TSK-73
  it("a reload mid-edit reopens the editor on the draft, unsaved", async () => {
    // First visit: type, then the page goes away (unmount, as a reload does).
    const first = renderEditor("Some body text.", [{ kind: "footnote", line: 1 }]);
    fireEvent.click(screen.getByTestId("body-edit"));
    const textarea = screen.getByTestId("markdown-editor");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "draft that must survive" } });
      await Promise.resolve();
    });
    first.unmount();
    expect(pending).toHaveLength(0);

    // Second visit, same tab: straight into edit, on the draft.
    renderEditor("Some body text.", [{ kind: "footnote", line: 1 }]);
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(markdownValue()).toBe("draft that must survive");
    expect(screen.getByTestId("save-indicator").getAttribute("data-state")).toBe("unsaved");
    expect(pending).toHaveLength(0);
  });
});

describe("BodyEditor — a Save in flight (A346)", () => {
  /**
   * Review M1: Cancel/Escape during an in-flight Save used to reset the
   * buffer under the write; when it landed, the old text was flushed as a
   * draft against the new token and restored on the next open as
   * "Unsaved changes". The write cannot be recalled, so Cancel and
   * Escape are unavailable until it settles.
   */
  // @verifies TSK-71
  it("Cancel is disabled and Escape does nothing while saving; no stale draft is left", async () => {
    renderEditor();
    await enterEditAndType();
    await act(async () => {
      fireEvent.click(screen.getByTestId("body-save"));
      await Promise.resolve();
    });
    expect(pending).toHaveLength(1);

    expect(screen.getByTestId("body-cancel").hasAttribute("disabled")).toBe(true);
    cancelCalls.count = 0;
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("markdown-editor"), { key: "Escape" });
      await Promise.resolve();
    });
    // Escape stops at the editor's own `saving` guard: it neither asks
    // nor reaches the hook's `cancel` (A348; `cancel` refusing by itself
    // would hide a missing guard from every other assertion here).
    expect(cancelCalls.count).toBe(0);
    expect(screen.queryByTestId("body-discard-dialog")).toBeNull();
    expect(screen.queryByTestId("body-rendered")).toBeNull();

    await act(async () => {
      succeedLast();
      await Promise.resolve();
    });
    await waitFor(() => { expect(screen.getByTestId("body-rendered")).toBeTruthy(); });
    expect(window.sessionStorage.getItem(draftKey(TASK_ID))).toBeNull();
  });

  /**
   * Review M3: a refetch that lands while the Save is in flight must not
   * swap the displayed text. The hook keeps the user's text in its
   * buffer; showing the other writer's text instead meant the editor
   * displayed theirs while a 409 conflict held "mine".
   */
  // @verifies XS-12
  it("a refetch during the save does not replace the text on screen, and a 409 keeps it", async () => {
    const view = renderEditor();
    await enterEditAndType();
    await act(async () => {
      fireEvent.click(screen.getByTestId("body-save"));
      await Promise.resolve();
    });
    expect(pending).toHaveLength(1);

    // The CLI wrote the body meanwhile; the refetch brings it in.
    view.rerender(
      <BodyEditor
        taskId={TASK_ID}
        taskRef="WEB-7"
        body="the CLI's text"
        bodyToken="tok-cli"
        lossyConstructs={[]}
        mentionCandidates={[]}
      />,
    );
    expect(markdownValue()).toBe("precious words the user typed");

    await act(async () => {
      const p = pending.shift();
      p?.settle(new Response(JSON.stringify({
        code: "conflict",
        message: "WEB-7 changed since you read it.",
        data_state: "not_saved",
        detail: JSON.stringify({ theirs: "the CLI's text", bodyToken: "tok-cli" }),
      }), { status: 409, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });
    await waitFor(() => { expect(screen.getByTestId("body-conflict-dialog")).toBeTruthy(); });
    expect(markdownValue()).toBe("precious words the user typed");
  });
});
