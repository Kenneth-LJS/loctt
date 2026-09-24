// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type BodyDraft, draftKey } from "./bodyDraft.ts";
import { BODY_IDLE_MS, type BodyAutosaveOptions, useBodyAutosave } from "./useBodyAutosave.ts";

/**
 * The description's save flow: explicit Save (K124), the draft store
 * (A338), and the K2 precondition.
 *
 * Timers are faked here and only here, and they now drive only the
 * draft cadence — since K124 no timer ever writes to disk. The request
 * count is what these tests assert on: "nothing was written" is only
 * meaningful next to a paired positive showing the hook does write when
 * the user saves.
 *
 * SUPERSEDED (K124, Ken 2026-09-24): this file used to assert TSK-15's
 * idle autosave ("fires one save after the idle window"), the save on
 * blur, the re-armed save of keystrokes typed mid-flight (TSK-38), and
 * A246's unmount flush + `flushForNav`. Those tests were green and
 * asserted the behaviour Ken ruled out — *"a lot of accidental
 * click-outs are happening which saves unintentionally"* — and are
 * rewritten below to the Save/Cancel model rather than kept.
 */

interface Recorded { readonly body: string; readonly expectedToken: unknown }

const TASK_ID = "01TESTTASK000000000000000A";

function mockApi() {
  const writes: Recorded[] = [];
  let nextToken = 1;
  let fail: { status: number; envelope: unknown } | null = null;

  const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(raw) as Recorded;
    writes.push(parsed);
    if (fail !== null) {
      const { status, envelope } = fail;
      return Promise.resolve(new Response(JSON.stringify(envelope), {
        status,
        headers: { "Content-Type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, bodyToken: `tok-${++nextToken}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    writes,
    failWith: (status: number, envelope: unknown) => { fail = { status, envelope }; },
    succeed: () => { fail = null; },
  };
}

/**
 * Lets pending promises settle while timers are faked. `waitFor` polls
 * on a real timer, which never advances here, so it deadlocks against
 * `vi.useFakeTimers`.
 */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

type Props = Omit<BodyAutosaveOptions, "taskRef" | "taskId">;

function harness(body = "start", extra: Partial<Props> = {}) {
  return renderHook(
    (p: Props) => useBodyAutosave({ taskRef: "T-1", taskId: TASK_ID, ...p }),
    { initialProps: { loadedBody: body, loadedToken: "tok-1", ...extra } },
  );
}

function storedDraft(): BodyDraft | null {
  const raw = window.sessionStorage.getItem(draftKey(TASK_ID));
  return raw === null ? null : JSON.parse(raw) as BodyDraft;
}

const CONFLICT_409 = {
  code: "conflict",
  message: "T-1 changed since you read it — your text has NOT been saved.",
  data_state: "not_saved",
  detail: JSON.stringify({ theirs: "the CLI's text", bodyToken: "tok-cli" }),
};

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  api = mockApi();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("K124 — only Save writes (TSK-15 amended)", () => {
  // @verifies TSK-15
  it("typing writes nothing to disk however long the user waits; Save writes once", async () => {
    const { result } = harness();

    for (const text of ["s1", "s12", "s123", "s1234", "s12345"]) {
      act(() => { result.current.edit(text); });
      await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS / 3); });
    }
    // Far past the old 1.5s idle window, several times over.
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 10); });

    expect(api.writes).toHaveLength(0);
    expect(result.current.state.kind).toBe("unsaved");
    expect(result.current.hasUnsavedWork).toBe(true);

    // Paired positive: the hook is alive and does write — on Save.
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(1);
    expect(api.writes[0]?.body).toBe("s12345");
    await settle();
    expect(result.current.state.kind).toBe("saved");
  });

  // @verifies TSK-15
  it("reports unsaved, then saving while the write is in flight, then saved", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(r => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      await gate;
      return original(u, init);
    });

    const { result } = harness();
    act(() => { result.current.edit("x"); });
    expect(result.current.state.kind).toBe("unsaved");

    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.save(); });
    await settle();
    expect(result.current.state.kind).toBe("saving");

    act(() => { release?.(); });
    await act(async () => { await saving; });
    await settle();
    expect(result.current.state.kind).toBe("saved");
  });

  // @verifies TSK-15
  it("typing back to the saved text is not a change", () => {
    const { result } = harness("start");
    act(() => { result.current.edit("start!"); });
    expect(result.current.hasUnsavedWork).toBe(true);
    act(() => { result.current.edit("start"); });
    expect(result.current.state.kind).toBe("saved");
    expect(result.current.hasUnsavedWork).toBe(false);
  });
});

describe("K124 — Cancel discards without writing", () => {
  // @verifies TSK-71
  it("cancel drops the text and the draft and writes nothing", async () => {
    const { result } = harness("on disk");
    act(() => { result.current.edit("typed and regretted"); });
    act(() => { result.current.flushDraft(); });
    expect(storedDraft()?.text).toBe("typed and regretted");

    act(() => { result.current.cancel(); });

    expect(result.current.state.kind).toBe("saved");
    expect(result.current.hasUnsavedWork).toBe(false);
    expect(storedDraft()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 3); });
    expect(api.writes).toHaveLength(0);
    // And the idle draft timer armed by the edit did not bring it back.
    expect(storedDraft()).toBeNull();

    // A Save after cancelling has nothing to write: the buffer is the base.
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(0);
  });
});

describe("XS-14 — Save is dirty-flag driven", () => {
  // @verifies XS-14
  it("does not write when nothing changed since the last save", async () => {
    const { result } = harness();
    // Save on an untouched editor (Cmd/Ctrl+Enter with no changes).
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(0);

    act(() => { result.current.edit("typed once"); });
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(1);

    await act(async () => { await result.current.save(); });
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(1);

    // Paired positive: one more change and it writes again.
    act(() => { result.current.edit("typed twice"); });
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1]?.body).toBe("typed twice");
  });
});

describe("TSK-38 — a save in flight does not resurrect old text", () => {
  // @verifies TSK-38
  it("keystrokes typed mid-save stay unsaved, are not auto-saved, and Save sends them", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(r => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      await gate;
      return original(u, init);
    });

    const { result } = harness();
    act(() => { result.current.edit("first"); });
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.save(); });
    await settle();

    // The write is in flight. Type more before it settles.
    act(() => { result.current.edit("first and second"); });

    act(() => { release?.(); });
    await act(async () => { await first; });
    await settle();
    expect(api.writes.at(-1)?.body).toBe("first");
    // Not "saved" while newer keystrokes exist.
    expect(result.current.state.kind).toBe("unsaved");
    expect(result.current.hasUnsavedWork).toBe(true);

    // K124: nothing re-saves them on its own. (Pre-K124 the hook re-armed
    // an autosave here.)
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 4); });
    expect(api.writes).toHaveLength(1);
    // Their draft is re-based on what just landed.
    expect(storedDraft()).toEqual({
      text: "first and second", baseToken: "tok-2", baseBody: "first",
    });

    await act(async () => { await result.current.save(); });
    await settle();
    expect(api.writes.at(-1)?.body).toBe("first and second");
    expect(result.current.state.kind).toBe("saved");
  });
});

describe("K2 — the precondition rides on every write", () => {
  // @verifies XS-11
  it("sends the token it loaded, and the fresh token after a save", async () => {
    const { result } = harness();
    act(() => { result.current.edit("one"); });
    await act(async () => { await result.current.save(); });
    expect(api.writes[0]?.expectedToken).toBe("tok-1");
    await settle();

    act(() => { result.current.edit("two"); });
    await act(async () => { await result.current.save(); });
    await settle();
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1]?.expectedToken).toBe("tok-2");
  });

  // @verifies XS-11
  it("a refetch while editing keeps the base token when the body changed on disk", async () => {
    // Under K124 an edit can stay open across a window refocus, which
    // refetches the task. If the CLI appended in the meantime, adopting
    // the refetched token would let Save overwrite the append silently.
    const { result, rerender } = harness("Original.");
    act(() => { result.current.edit("Original. My addition."); });

    rerender({ loadedBody: "Original.\n\nNote from CLI", loadedToken: "tok-cli" });

    await act(async () => { await result.current.save(); });
    expect(api.writes[0]?.expectedToken).toBe("tok-1");
  });

  // @verifies XS-11
  it("a refetch while editing adopts the new token when only frontmatter moved", async () => {
    // A status change in the meta panel bumps `updated_at`, so the token,
    // without touching the body. That must not turn Save into a conflict.
    const { result, rerender } = harness("Original.");
    act(() => { result.current.edit("Original. Mine."); });

    rerender({ loadedBody: "Original.", loadedToken: "tok-status-changed" });

    await act(async () => { await result.current.save(); });
    expect(api.writes[0]?.expectedToken).toBe("tok-status-changed");
    // And the user's text survived the refetch.
    expect(api.writes[0]?.body).toBe("Original. Mine.");
  });

  // @verifies XS-12
  it("a refused Save raises a conflict carrying both versions and writes nothing", async () => {
    const { result } = harness();
    api.failWith(409, CONFLICT_409);

    act(() => { result.current.edit("my draft"); });
    await act(async () => { await result.current.save(); });
    await settle();

    expect(result.current.conflict).not.toBeNull();
    expect(result.current.conflict?.mine).toBe("my draft");
    expect(result.current.conflict?.theirs).toBe("the CLI's text");
    // TSK-48: not "saved", and not back to idle.
    expect(result.current.state.kind).toBe("failed");
  });

  // @verifies XS-12
  it("dismissing the conflict writes nothing and keeps the text", async () => {
    const { result } = harness();
    api.failWith(409, CONFLICT_409);
    act(() => { result.current.edit("mine"); });
    await act(async () => { await result.current.save(); });
    await settle();
    expect(result.current.conflict).not.toBeNull();

    const before = api.writes.length;
    act(() => { result.current.dismissConflict(); });

    expect(api.writes).toHaveLength(before);
    expect(result.current.conflict).toBeNull();
    // XS-65: the state still says unsaved, not "saved".
    expect(result.current.state.kind).toBe("failed");
  });

  // @verifies XS-12
  it("resolving writes the chosen text against the conflicting version's token", async () => {
    const { result } = harness();
    api.failWith(409, CONFLICT_409);
    act(() => { result.current.edit("mine"); });
    await act(async () => { await result.current.save(); });
    await settle();

    api.succeed();
    await act(async () => { await result.current.resolve("the CLI's text\n\nmine"); });

    const last = api.writes.at(-1);
    expect(last?.body).toBe("the CLI's text\n\nmine");
    // Still conditional — a third writer between the refusal and this
    // resolution must not be clobbered by the resolution itself.
    expect(last?.expectedToken).toBe("tok-cli");
  });

  // @verifies XS-12
  it("'keep theirs' writes nothing — the disk already holds it — and leaves the editor clean", async () => {
    const { result } = harness();
    api.failWith(409, CONFLICT_409);
    act(() => { result.current.edit("mine"); });
    await act(async () => { await result.current.save(); });
    await settle();
    const before = api.writes.length;

    api.succeed();
    await act(async () => { await result.current.resolve("the CLI's text"); });
    await settle();

    // No write, so no history entry for a change nobody made (K124).
    expect(api.writes).toHaveLength(before);
    expect(result.current.conflict).toBeNull();
    expect(result.current.state.kind).toBe("saved");
    expect(storedDraft()).toBeNull();

    // The editor is based on theirs now: the next Save carries its token.
    act(() => { result.current.edit("the CLI's text, then more"); });
    await act(async () => { await result.current.save(); });
    expect(api.writes.at(-1)?.expectedToken).toBe("tok-cli");
  });
});

describe("TSK-48 / ERR-27 — a failed save is loud and keeps the text", () => {
  // @verifies TSK-48
  it("moves to failed, never to saved, and offers a retry that works", async () => {
    const { result } = harness();
    api.failWith(500, {
      code: "io_failed",
      message: "No space left on device.",
      data_state: "not_saved",
      detail: "ENOSPC: no space left on device",
    });

    act(() => { result.current.edit("precious words"); });
    await act(async () => { await result.current.save(); });
    await settle();

    expect(result.current.state.kind).toBe("failed");
    const failed = result.current.state;
    expect(failed.kind === "failed" && failed.message).toContain("No space left on device");
    expect(failed.kind === "failed" && failed.message).toContain("not been saved");
    expect(result.current.hasUnsavedWork).toBe(true);
    // The draft keeps the text for this tab too (A338).
    expect(storedDraft()?.text).toBe("precious words");

    api.succeed();
    await act(async () => { await result.current.retry(); });
    expect(api.writes.at(-1)?.body).toBe("precious words");
    await settle();
    expect(result.current.state.kind).toBe("saved");
    expect(storedDraft()).toBeNull();
  });

  // @verifies ERR-12
  it("names disk-full as the cause and keeps the buffer for a retry", async () => {
    const { result } = harness();
    api.failWith(507, {
      code: "io_failed",
      message: "There is no space left on the disk, so the change was not saved.",
      data_state: "not_saved",
      recovery: { kind: "retry" },
      detail: "ENOSPC: no space left on device, write",
    });

    act(() => { result.current.edit("a long body the user wrote"); });
    await act(async () => { await result.current.save(); });
    await settle();

    const failed = result.current.state;
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.message).toContain("no space left on the disk");
    expect(failed.kind === "failed" && failed.detail).toContain("ENOSPC");

    api.succeed();
    await act(async () => { await result.current.retry(); });
    expect(api.writes.at(-1)?.body).toBe("a long body the user wrote");
  });

  // @verifies ERR-11
  it("names a permission problem at save time and keeps the buffer", async () => {
    const { result } = harness();
    api.failWith(500, {
      code: "io_failed",
      message:
        "LocTT does not have permission to write to this file "
        + "(.loctt/tasks/T-1/task.md). Check the file's permissions and "
        + "the ownership of the .loctt directory.",
      data_state: "not_saved",
      recovery: { kind: "retry" },
      detail: "EACCES: permission denied, open '.loctt/tasks/T-1/task.md'",
    });

    act(() => { result.current.edit("work the user does not want to lose"); });
    await act(async () => { await result.current.save(); });
    await settle();

    const failed = result.current.state;
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.message).toMatch(/permission/i);
    expect(failed.kind === "failed" && failed.message).toContain(".loctt");
    expect(failed.kind === "failed" && failed.message).toContain("not been saved");
    expect(failed.kind === "failed" && failed.detail).toContain("EACCES");
    expect(failed.kind === "failed" && failed.message).not.toContain("EACCES");
    // A retry issues a FRESH write of the same text: a buffer clobbered
    // back to the base would equal it and skip the POST entirely.
    expect(result.current.hasUnsavedWork).toBe(true);
    const writesBeforeRetry = api.writes.length;
    api.succeed();
    await act(async () => { await result.current.retry(); });
    expect(api.writes.length).toBe(writesBeforeRetry + 1);
    expect(api.writes.at(-1)?.body).toBe("work the user does not want to lose");
  });

  // @verifies ERR-27
  it("a save failure is reported and persists — it is not a toast that clears itself", async () => {
    const { result } = harness();
    api.failWith(500, { code: "io_failed", message: "Write failed.", data_state: "not_saved" });

    act(() => { result.current.edit("typed"); });
    await act(async () => { await result.current.save(); });
    await settle();
    expect(result.current.state.kind).toBe("failed");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.state.kind).toBe("failed");
  });
});

describe("A59 — no write leaves while the conflict dialog is open", () => {
  /** A fetch whose responses land only when the test releases them. */
  function heldFetch() {
    const writes: Recorded[] = [];
    const held: Array<{ token: unknown; release: () => void }> = [];
    vi.stubGlobal("fetch", vi.fn((_url: string | URL, init?: RequestInit) => {
      const raw = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(raw) as Recorded;
      writes.push(parsed);
      return new Promise<Response>(res => {
        held.push({
          token: parsed.expectedToken,
          release: () => {
            if (parsed.expectedToken === "tok-cli") {
              res(new Response(JSON.stringify({ ok: true, bodyToken: "tok-3" }), {
                status: 200, headers: { "Content-Type": "application/json" },
              }));
              return;
            }
            res(new Response(JSON.stringify(CONFLICT_409), {
              status: 409, headers: { "Content-Type": "application/json" },
            }));
          },
        });
      });
    }));
    return { writes, held };
  }

  async function openConflict(
    result: { current: ReturnType<typeof useBodyAutosave> },
    held: ReturnType<typeof heldFetch>["held"],
  ): Promise<void> {
    act(() => { result.current.edit("mine"); });
    act(() => { void result.current.save(); });
    await settle();
    expect(held).toHaveLength(1);
    held.shift()?.release();
    await settle();
    expect(result.current.conflict).not.toBeNull();
  }

  // @verifies XS-12
  it("a Save pressed while the dialog is open sends nothing, and Apply is not re-opened", async () => {
    const { writes, held } = heldFetch();
    const { result } = harness();
    await openConflict(result, held);

    // A second Save (Cmd/Ctrl+S behind the dialog) while it is open.
    let second: Promise<void> = Promise.resolve();
    act(() => { second = result.current.save(); });
    await settle();

    let applied: Promise<void> = Promise.resolve();
    act(() => { applied = result.current.resolve("the CLI's text\n\nmine"); });
    expect(result.current.conflict).toBeNull();

    for (let i = 0; i < 5; i += 1) {
      await settle();
      if (held.length > 0) held.shift()?.release();
    }
    await act(async () => { await second; await applied; });
    await settle();

    expect(result.current.conflict).toBeNull();
    expect(result.current.state.kind).toBe("saved");
    // The refused Save and the resolution are the only two writes.
    expect(writes).toHaveLength(2);
    expect(writes.at(-1)?.body).toBe("the CLI's text\n\nmine");
    expect(writes.at(-1)?.expectedToken).toBe("tok-cli");
  });

  // The guard must suppress, not wedge.
  it("dismiss then retry still re-raises the conflict", async () => {
    const { writes, held } = heldFetch();
    const { result } = harness();
    await openConflict(result, held);

    act(() => { void result.current.save(); });
    await settle();
    expect(writes).toHaveLength(1);
    expect(result.current.hasUnsavedWork).toBe(true);

    act(() => { result.current.dismissConflict(); });
    let retried: Promise<void> = Promise.resolve();
    act(() => { retried = result.current.retry(); });
    await settle();
    expect(writes).toHaveLength(2);
    held.shift()?.release();
    await settle();
    await act(async () => { await retried; });
    expect(result.current.conflict).not.toBeNull();
  });
});

describe("K124 — leaving writes nothing to disk", () => {
  // SUPERSEDED: A246's "re-flushes a dirty FAILED buffer on unmount" and
  // its `flushForNav` tests asserted a write on leaving. Under K124
  // leaving never writes; the unsaved text goes to the draft store.
  // @verifies TSK-71
  it("unmounting with unsaved text sends no write and keeps a draft", async () => {
    const { result, unmount } = harness("base");
    act(() => { result.current.edit("unsaved words"); });

    await act(async () => { unmount(); await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 2); });

    expect(api.writes).toHaveLength(0);
    expect(storedDraft()).toEqual({ text: "unsaved words", baseToken: "tok-1", baseBody: "base" });
  });

  it("unmounting a clean editor writes nothing and leaves no draft", async () => {
    const { unmount } = harness();
    await act(async () => { unmount(); await vi.advanceTimersByTimeAsync(0); });
    expect(api.writes).toHaveLength(0);
    expect(storedDraft()).toBeNull();
  });

  // @verifies TSK-48
  it("beforeunload with unsaved text is prevented (the browser warns) and flushes the draft", () => {
    const { result } = harness("base");
    act(() => { result.current.edit("mid-edit"); });
    // Before the idle window: no draft yet.
    expect(storedDraft()).toBeNull();

    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(storedDraft()?.text).toBe("mid-edit");
  });

  it("beforeunload on a clean editor does not warn", () => {
    harness("base");
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("A338 — the unsaved draft in sessionStorage", () => {
  // @verifies TSK-73
  it("is written on the idle cadence, once for a burst, with the base it is against", async () => {
    const { result } = harness("base");
    act(() => { result.current.edit("b"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS / 2); });
    act(() => { result.current.edit("bu"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS / 2); });
    // Re-armed by the second keystroke: still inside the window.
    expect(storedDraft()).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    expect(storedDraft()).toEqual({ text: "bu", baseToken: "tok-1", baseBody: "base" });
    // The draft is not the disk.
    expect(api.writes).toHaveLength(0);
  });

  // @verifies TSK-73
  it("flushDraft writes it at once (blur, Escape, Cmd/Ctrl+Enter)", () => {
    const { result } = harness("base");
    act(() => { result.current.edit("now"); });
    act(() => { result.current.flushDraft(); });
    expect(storedDraft()?.text).toBe("now");
  });

  // @verifies TSK-73
  it("is cleared by a Save that lands", async () => {
    const { result } = harness("base");
    act(() => { result.current.edit("saved text"); });
    act(() => { result.current.flushDraft(); });
    await act(async () => { await result.current.save(); });
    await settle();
    expect(storedDraft()).toBeNull();
  });

  // @verifies TSK-73
  it("reopening with a draft whose base matches restores it, unsaved, and Save writes it", async () => {
    const { result } = harness("on disk", {
      initialDraft: { text: "restored words", baseToken: "tok-1", baseBody: "on disk" },
    });

    expect(result.current.state.kind).toBe("unsaved");
    expect(result.current.conflict).toBeNull();
    expect(result.current.hasUnsavedWork).toBe(true);
    expect(api.writes).toHaveLength(0);

    await act(async () => { await result.current.save(); });
    expect(api.writes[0]).toEqual({ body: "restored words", expectedToken: "tok-1" });
  });

  // @verifies TSK-73
  it("a draft whose token moved but whose base body is unchanged restores silently with the fresh token", async () => {
    // Only frontmatter moved (a status change): the draft cannot
    // overwrite anyone's text.
    const { result } = harness("on disk", {
      loadedToken: "tok-after-status-change",
      initialDraft: { text: "restored words", baseToken: "tok-1", baseBody: "on disk" },
    });
    expect(result.current.conflict).toBeNull();
    expect(result.current.state.kind).toBe("unsaved");

    await act(async () => { await result.current.save(); });
    expect(api.writes[0]?.expectedToken).toBe("tok-after-status-change");
  });

  // @verifies TSK-73
  it("a draft whose base body changed on disk opens the conflict (mine = draft, theirs = disk) and writes nothing", async () => {
    const { result } = harness("changed on disk by the CLI", {
      loadedToken: "tok-cli",
      initialDraft: { text: "my draft", baseToken: "tok-1", baseBody: "the old body" },
    });

    expect(result.current.conflict).toEqual({
      mine: "my draft", theirs: "changed on disk by the CLI", theirToken: "tok-cli",
    });
    expect(result.current.state.kind).toBe("failed");
    expect(api.writes).toHaveLength(0);

    // A Save behind the dialog is suppressed (A59) — never a silent overwrite.
    await act(async () => { await result.current.save(); });
    expect(api.writes).toHaveLength(0);

    // "Keep mine" writes the draft against the disk version's token.
    await act(async () => { await result.current.resolve("my draft"); });
    expect(api.writes[0]).toEqual({ body: "my draft", expectedToken: "tok-cli" });
  });

  // @verifies TSK-73
  it("a draft identical to what is on disk restores nothing", () => {
    const { result } = harness("same", {
      initialDraft: { text: "same", baseToken: "tok-0", baseBody: "older" },
    });
    expect(result.current.state.kind).toBe("saved");
    expect(result.current.conflict).toBeNull();
  });
});
