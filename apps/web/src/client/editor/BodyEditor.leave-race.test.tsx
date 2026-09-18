// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fix-review HIGH #1 — the blur-leave race (TSK-48 / TSK-71).
 *
 * This is the ONE `BodyEditor` test that mounts the REAL `useBodyAutosave`
 * rather than the mocked hook in `BodyEditor.test.tsx`. The mocked-hook
 * test cannot see this bug: the mock's `state` is whatever the test set,
 * so there is no `unsaved → saving` transition and no microtask gap to
 * race against. The bug lives exactly in that gap, so only the real hook
 * with a controlled write can reproduce it.
 *
 * ## The race
 *
 * `requestLeave` (on blur) does two things in one synchronous block:
 * `setWantsLeave(true)` and `void flush()`. `flush` runs the network
 * `write()` in a MICROTASK (`prior.then(() => write())`), and `write()`
 * is what moves the state to `saving`. So React can re-render from
 * `setWantsLeave(true)` and run the `wantsLeave` effect while the state
 * is STILL `unsaved` — the pre-flush state — because the `saving`
 * transition has not run yet.
 *
 * The ORIGINAL effect gated on `state.kind === "saving"` only ("leave
 * unless we are saving"), so it treated that pre-flush `unsaved` as
 * "clean, safe to leave" and called `onLeave()` — unmounting the edit
 * surface BEFORE the POST even started. A failing save then landed on an
 * unmounted component and the user's typed text was lost with no error
 * shown (the TSK-48 violation).
 *
 * THE FIX: the effect leaves ONLY on `state.kind === "saved"`. It waits
 * through `unsaved` and `saving`, and a `failed` write keeps the editor
 * open on the unsaved text.
 *
 * ## How this test controls the timing
 *
 * Only the network is mocked (a DEFERRED `fetch` we resolve by hand,
 * like `useBodyAutosave.test.ts`'s held-fetch). We type, blur, and let
 * the leave-effect run WHILE the write is still pending — then resolve
 * the write as a FAILURE and assert the editor stayed mounted with the
 * typed text retained and a failed state shown.
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

const { BodyEditor } = await import("./BodyEditor.tsx");

beforeEach(() => { installDeferredFetch(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

// Enters edit, switches to the markdown surface, and types `typed`.
// Returns the textarea so the test can blur off it.
function markdownValue(): string {
  const el = screen.getByTestId("markdown-editor");
  return el instanceof HTMLTextAreaElement ? el.value : "";
}

async function enterEditAndType(): Promise<void> {
  fireEvent.click(screen.getByText("Some body text."));
  fireEvent.click(screen.getByTestId("mode-raw"));
  const textarea = screen.getByTestId("markdown-editor");
  textarea.focus();
  await act(async () => {
    fireEvent.change(textarea, { target: { value: "precious words the user typed" } });
    await Promise.resolve();
  });
}

describe("BodyEditor — blur-leave race (fix-review HIGH #1)", () => {
  // @verifies TSK-48
  it("a failing save on blur keeps the editor open and does NOT drop to the rendered view", async () => {
    renderEditor();
    await enterEditAndType();

    // Blur out of the editor. This is `requestLeave`: it sets
    // `wantsLeave` AND flushes — and the flush's `write()` is a
    // microtask, so the leave-effect can run on the pre-flush `unsaved`
    // state. `act` flushes React's work here; the fix must hold the
    // editor open through `unsaved`/`saving` rather than leave on the
    // pre-flush `unsaved`.
    await act(async () => {
      fireEvent.blur(screen.getByTestId("body-editor"), { relatedTarget: null });
      await Promise.resolve();
    });

    // The write is genuinely in flight (deferred, not yet settled).
    expect(pending.length).toBe(1);
    expect(pending[0]?.body).toBe("precious words the user typed");

    // THE ASSERTION THAT GOES RED ON THE ORIGINAL CODE: the editor must
    // still be mounted. The original effect left on the pre-flush
    // `unsaved`, unmounting the surface before the POST resolved.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();

    // Now the write FAILS. A failing save landing on an unmounted
    // component was the data loss; with the editor still mounted it
    // surfaces as a failed state and the text is retained.
    await act(async () => {
      failLast();
      await Promise.resolve();
    });

    // Editor still mounted, text retained, failure shown — not a silent
    // drop to a stale render.
    expect(screen.queryByTestId("body-rendered")).toBeNull();
    expect(screen.getByTestId("markdown-editor")).toBeTruthy();
    expect(markdownValue()).toBe("precious words the user typed");
    expect(screen.getByText(/No space left on device/)).toBeTruthy();
  });
});
