// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBodyDraft, draftKey, readBodyDraft, writeBodyDraft } from "./bodyDraft.ts";
import { useBodyAutosave } from "./useBodyAutosave.ts";

/**
 * The draft store (A338): the key shape, the round trip, and — the part
 * that can take a page down — degrading silently when `sessionStorage`
 * is blocked or full.
 */

const ID = "01TESTTASK000000000000000B";

/** Makes every Storage access throw, as a blocked store does (SHL-18's shape). */
function blockStorage(): void {
  const boom = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
}

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("A338 — draft store", () => {
  // @verifies TSK-73
  it("keys drafts as loctt:draft:<taskId>:<field> in sessionStorage, not localStorage", () => {
    expect(draftKey(ID)).toBe(`loctt:draft:${ID}:body`);
    writeBodyDraft(ID, { text: "t", baseToken: "k", baseBody: "b" });
    expect(window.sessionStorage.getItem(`loctt:draft:${ID}:body`)).not.toBeNull();
    // A closed tab's draft must not resurface days later (A338's
    // rejected option), so nothing lands in localStorage.
    expect(window.localStorage.getItem(`loctt:draft:${ID}:body`)).toBeNull();
  });

  // @verifies TSK-73
  it("round-trips a draft and clears it", () => {
    writeBodyDraft(ID, { text: "my words", baseToken: "tok-1", baseBody: "base" });
    expect(readBodyDraft(ID)).toEqual({ text: "my words", baseToken: "tok-1", baseBody: "base" });
    clearBodyDraft(ID);
    expect(readBodyDraft(ID)).toBeNull();
  });

  it("drops a malformed entry rather than restoring garbage", () => {
    window.sessionStorage.setItem(draftKey(ID), "{not json");
    expect(readBodyDraft(ID)).toBeNull();
    expect(window.sessionStorage.getItem(draftKey(ID))).toBeNull();

    window.sessionStorage.setItem(draftKey(ID), JSON.stringify({ text: 3 }));
    expect(readBodyDraft(ID)).toBeNull();
  });

  // @verifies TSK-73
  it("with storage blocked, reading, writing and clearing degrade silently", () => {
    blockStorage();
    expect(() => { writeBodyDraft(ID, { text: "t", baseToken: "k", baseBody: "b" }); }).not.toThrow();
    expect(readBodyDraft(ID)).toBeNull();
    expect(() => { clearBodyDraft(ID); }).not.toThrow();
  });

  // @verifies TSK-73
  it("with storage blocked, the editor still edits, warns, and saves in-session", async () => {
    blockStorage();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ ok: true, bodyToken: "tok-2" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useBodyAutosave({
      taskRef: "T-1", taskId: ID, loadedBody: "base", loadedToken: "tok-1",
    }));
    act(() => { result.current.edit("typed"); });
    act(() => { result.current.flushDraft(); });
    expect(result.current.hasUnsavedWork).toBe(true);

    await act(async () => { await result.current.save(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("saved");
    expect(() => { unmount(); }).not.toThrow();
    vi.unstubAllGlobals();
  });
});
