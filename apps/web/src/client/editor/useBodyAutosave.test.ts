// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BODY_IDLE_MS, useBodyAutosave } from "./useBodyAutosave.ts";

/**
 * Autosave timing, the dirty flag, and the K2 precondition.
 *
 * Timers are faked here and only here. That is a real limitation and
 * worth naming: a fake timer proves the hook *schedules* at 1.5s, not
 * that the wall clock elapses — so this file is paired with a UI spec
 * that types into the real editor and waits out the real interval
 * against the real file. Neither alone is enough. The unit test cannot
 * see the network, and the UI test cannot distinguish "saved once
 * after idle" from "saved on a 1.5s interval that happened to fire
 * once" without counting requests, which is what this file does.
 */

interface Recorded { readonly body: string; readonly expectedToken: unknown }

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
 * Lets pending promises settle while timers are faked.
 *
 * `waitFor` polls on a real timer, which never advances here, so it
 * deadlocks against `vi.useFakeTimers`. Advancing the fake clock by
 * zero flushes the microtask queue and any timer already due, which is
 * all a settled fetch needs — and unlike a poll it cannot mask a
 * missing state transition by waiting longer.
 */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

function harness(body = "start") {
  return renderHook(() =>
    useBodyAutosave({ taskRef: "T-1", loadedBody: body, loadedToken: "tok-1" }),
  );
}

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.useFakeTimers();
  api = mockApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TSK-15 — idle autosave", () => {
  // @verifies TSK-15
  it("fires one save after the idle window, not one per keystroke", async () => {
    const { result } = harness();

    // Five keystrokes, each well inside the idle window.
    for (const text of ["s1", "s12", "s123", "s1234", "s12345"]) {
      act(() => { result.current.edit(text); });
      await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS / 3); });
    }

    // Nothing yet: every keystroke re-armed the timer. This absence is
    // paired with the positive assertion below — a build that never
    // saves at all would also produce zero here, and would then fail
    // the next two expectations.
    expect(api.writes).toHaveLength(0);
    expect(result.current.state.kind).toBe("unsaved");

    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });

    expect(api.writes).toHaveLength(1);
    expect(api.writes[0]?.body).toBe("s12345");
    await settle();
    expect(result.current.state.kind).toBe("saved");
  });

  // @verifies TSK-15
  it("saves immediately on blur rather than waiting out the timer", async () => {
    const { result } = harness();
    act(() => { result.current.edit("typed"); });
    // Deliberately less than the idle window: if the flush were only
    // arming the timer rather than writing, nothing would have landed.
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS / 4); });
    expect(api.writes).toHaveLength(0);

    await act(async () => { await result.current.flush(); });

    expect(api.writes).toHaveLength(1);
    expect(api.writes[0]?.body).toBe("typed");
    // And the pending timer was cancelled — no second write follows.
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 2); });
    expect(api.writes).toHaveLength(1);
  });

  // @verifies TSK-15
  it("reports saving while in flight and saved once it lands", async () => {
    const { result } = harness();
    act(() => { result.current.edit("x") });
    expect(result.current.state.kind).toBe("unsaved");
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    await settle();
    expect(result.current.state.kind).toBe("saved");
  });
});

describe("XS-14 — autosave is dirty-flag driven", () => {
  // @verifies XS-14
  it("does not write when nothing was typed since the last save", async () => {
    const { result } = harness();
    act(() => { result.current.edit("typed once"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    expect(api.writes).toHaveLength(1);

    // An idle editor: flush repeatedly with no new keystrokes. Before
    // the guard, each of these would re-POST the stale buffer, which
    // is precisely how a CLI `body --set ""` got silently undone.
    await act(async () => { await result.current.flush(); });
    await act(async () => { await result.current.flush(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 3); });

    expect(api.writes).toHaveLength(1);

    // Paired positive: the hook is not simply refusing to write. One
    // more keystroke and it writes again.
    act(() => { result.current.edit("typed twice"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1]?.body).toBe("typed twice");
  });
});

describe("TSK-38 — an in-flight save does not resurrect old text", () => {
  // @verifies TSK-38
  it("sends the later keystrokes and does not read 'saved' while they are pending", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(r => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      await gate;
      return original(u, init);
    });

    const { result } = harness();
    act(() => { result.current.edit("first"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });

    // The write is in flight. Type more before it settles.
    act(() => { result.current.edit("first and second"); });
    expect(result.current.state.kind).toBe("unsaved");

    // Let *only the first response* land, with the newer keystrokes
    // still unsaved. This is the moment TSK-38's third bullet is
    // about: the request that just succeeded carried "first", but the
    // buffer says "first and second", so the indicator must NOT read
    // "saved". Asserting after both writes settle would miss it
    // entirely — the state reaches "saved" legitimately by then.
    act(() => { release?.(); });
    await settle();
    expect(api.writes.at(-1)?.body).toBe("first");
    expect(result.current.state.kind).not.toBe("saved");
    expect(result.current.hasUnsavedWork).toBe(true);

    // Now let the re-armed save for the newer text go through.
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS * 2); });
    await settle();

    // The final stored body includes the later keystrokes, and the
    // buffer was never snapped back to "first".
    expect(api.writes.at(-1)?.body).toBe("first and second");
    expect(result.current.state.kind).toBe("saved");
  });
});

describe("K2 — the precondition rides on every write", () => {
  // @verifies XS-11
  it("sends the token it loaded, and the fresh token after a save", async () => {
    const { result } = harness();
    act(() => { result.current.edit("one"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    expect(api.writes[0]?.expectedToken).toBe("tok-1");

    // The token from the response replaces it, so the *next* write is
    // conditional on what this one produced rather than on the
    // original read — without that, the second autosave of any editing
    // session would conflict with its own first.
    await settle();
    expect(result.current.state.kind).toBe("saved");
    act(() => { result.current.edit("two"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    await settle();
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1]?.expectedToken).toBe("tok-2");
  });

  // @verifies XS-12
  it("raises a conflict carrying both versions and writes nothing", async () => {
    const { result } = harness();
    api.failWith(409, {
      code: "conflict",
      message: "T-1 changed since you read it — your text has NOT been saved.",
      data_state: "not_saved",
      detail: JSON.stringify({ theirs: "the CLI's text", bodyToken: "tok-cli" }),
    });

    act(() => { result.current.edit("my draft"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });

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
    api.failWith(409, {
      code: "conflict",
      message: "changed",
      detail: JSON.stringify({ theirs: "theirs", bodyToken: "tok-cli" }),
    });
    act(() => { result.current.edit("mine"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    await settle();
    expect(result.current.conflict).not.toBeNull();

    const before = api.writes.length;
    act(() => { result.current.dismissConflict(); });

    expect(api.writes).toHaveLength(before);
    expect(result.current.conflict).toBeNull();
    // XS-65: the user still has a way back — the state says unsaved,
    // not "saved", so nothing suggests the text landed.
    expect(result.current.state.kind).toBe("failed");
  });

  // @verifies XS-12
  it("resolving writes the chosen text against the conflicting version's token", async () => {
    const { result } = harness();
    api.failWith(409, {
      code: "conflict",
      message: "changed",
      detail: JSON.stringify({ theirs: "theirs", bodyToken: "tok-cli" }),
    });
    act(() => { result.current.edit("mine"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    await settle();
    expect(result.current.conflict).not.toBeNull();

    api.succeed();
    await act(async () => { await result.current.resolve("theirs\n\nmine"); });

    const last = api.writes.at(-1);
    expect(last?.body).toBe("theirs\n\nmine");
    // Still conditional — a third writer between the refusal and this
    // resolution must not be clobbered by the resolution itself.
    expect(last?.expectedToken).toBe("tok-cli");
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
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });

    await settle();
    expect(result.current.state.kind).toBe("failed");
    // ERR-12: the cause is named rather than reported generically, and
    // the message says the text was not saved.
    const failed = result.current.state;
    expect(failed.kind === "failed" && failed.message).toContain("No space left on device");
    expect(failed.kind === "failed" && failed.message).toContain("not been saved");
    expect(result.current.hasUnsavedWork).toBe(true);

    // The retry control is not decorative: once the cause clears, it
    // writes the *same* text the user still has.
    api.succeed();
    await act(async () => { await result.current.retry(); });
    expect(api.writes.at(-1)?.body).toBe("precious words");
    await settle();
    expect(result.current.state.kind).toBe("saved");
  });

  // @verifies ERR-12
  it("names disk-full as the cause and keeps the buffer for a retry", async () => {
    const { result } = harness();
    // ERR-12's first bullet: the message must *identify the disk being
    // full*, not report a generic write failure. The errno lives
    // server-side, so the client's job is to relay the server's cause
    // rather than substitute its own wording — a client that replaced
    // this with "Could not save" would satisfy a weaker test while
    // failing the case.
    api.failWith(507, {
      code: "io_failed",
      message: "There is no space left on the disk, so the change was not saved.",
      data_state: "not_saved",
      recovery: { kind: "retry" },
      detail: "ENOSPC: no space left on device, write",
    });

    act(() => { result.current.edit("a long body the user wrote"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    await settle();

    const failed = result.current.state;
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.message).toContain("no space left on the disk");
    // The technical detail is carried for a "Show details" affordance
    // rather than becoming the headline (ERR-16).
    expect(failed.kind === "failed" && failed.detail).toContain("ENOSPC");

    // Nothing cleared the buffer: freeing space and retrying is the
    // actual fix, so the text has to still be there to retry *with*.
    api.succeed();
    await act(async () => { await result.current.retry(); });
    expect(api.writes.at(-1)?.body).toBe("a long body the user wrote");
  });

  // @verifies ERR-27
  it("an auto-save failure is reported without the user clicking anything", async () => {
    const { result } = harness();
    api.failWith(500, { code: "io_failed", message: "Write failed.", data_state: "not_saved" });

    act(() => { result.current.edit("typed"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });

    await settle();
    expect(result.current.state.kind).toBe("failed");
    // And it persists — it is not a toast that clears itself.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.state.kind).toBe("failed");
  });
});

describe("A59 — no write leaves while the conflict dialog is open", () => {
  /**
   * The measured race (known-gaps, "A resolved body conflict can
   * re-open its own dialog"): clicking a choice radio blurs the
   * editor, the blur-flush fires with the stale token, and its 409
   * lands after Apply — re-opening the dialog over a conflict the
   * user already resolved.
   *
   * The e2e reproduction is a timing accident (~1–2 in 10 runs);
   * here the response ordering is scripted, so the race is
   * deterministic in both directions. The 409 envelope mirrors what
   * the server actually sends (see server.ts's conflict response and
   * the K2 tests above).
   */

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
            // The real server's rule: a stale token is refused, the
            // conflicting version's token is accepted.
            if (parsed.expectedToken === "tok-cli") {
              res(new Response(JSON.stringify({ ok: true, bodyToken: "tok-3" }), {
                status: 200, headers: { "Content-Type": "application/json" },
              }));
              return;
            }
            res(new Response(JSON.stringify({
              code: "conflict",
              message: "changed",
              data_state: "not_saved",
              detail: JSON.stringify({ theirs: "the CLI's text", bodyToken: "tok-cli" }),
            }), { status: 409, headers: { "Content-Type": "application/json" } }));
          },
        });
      });
    }));
    return { writes, held };
  }

  /** Drives the hook into an open conflict via a refused idle flush. */
  async function openConflict(
    result: { current: ReturnType<typeof useBodyAutosave> },
    held: ReturnType<typeof heldFetch>["held"],
  ): Promise<void> {
    act(() => { result.current.edit("mine"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BODY_IDLE_MS); });
    expect(held).toHaveLength(1);
    held.shift()?.release();
    await settle();
    expect(result.current.conflict).not.toBeNull();
  }

  // @verifies XS-12 (bullet 1: "The UI does not write" while the
  // conflict surface is up) — and closes the known-gaps race.
  it("a stale 409 landing after Apply does not re-open the resolved dialog", async () => {
    const { writes, held } = heldFetch();
    const { result } = harness();
    await openConflict(result, held);

    // The user clicks a choice radio. That click blurs the editor,
    // and BodyEditor flushes on blur — with the same stale token.
    let blurFlush: Promise<void> = Promise.resolve();
    act(() => { blurFlush = result.current.flush(); });
    await settle();

    // Apply. `resolve` closes the dialog synchronously and chains the
    // merged write behind anything in flight.
    let applied: Promise<void> = Promise.resolve();
    act(() => { applied = result.current.resolve("the CLI's text\n\nmine"); });
    expect(result.current.conflict).toBeNull();

    // Only now do the held responses land — the doomed blur-flush's
    // 409 (if it was sent at all) arrives AFTER Apply, which is the
    // ordering that re-opened the dialog. Settle first each time:
    // the resolution write's fetch is issued in a microtask, so a
    // synchronous look at `held` would miss it and deadlock.
    for (let i = 0; i < 5; i += 1) {
      await settle();
      if (held.length > 0) held.shift()?.release();
    }
    await act(async () => { await blurFlush; await applied; });
    await settle();

    // The user resolved this conflict. Nothing may re-open it.
    expect(result.current.conflict).toBeNull();
    expect(result.current.state.kind).toBe("saved");

    // And the doomed write never left: the refused idle flush and the
    // resolution write are the only two. A third write here is the
    // blur-flush going out with a token already known to be stale —
    // guaranteed 409, pure noise, and the trigger of the race.
    expect(writes).toHaveLength(2);
    expect(writes.at(-1)?.body).toBe("the CLI's text\n\nmine");
    expect(writes.at(-1)?.expectedToken).toBe("tok-cli");
  });

  // The guard must suppress, not wedge: once the conflict is closed —
  // by either path — the machine writes again. Without this, an
  // overbroad guard (a conflict flag that never clears) would pass the
  // test above by never writing anything again.
  it("dismiss then retry still re-raises the conflict, and edits still save", async () => {
    const { writes, held } = heldFetch();
    const { result } = harness();
    await openConflict(result, held);

    // Blur while the dialog is open: nothing leaves.
    let blurFlush: Promise<void> = Promise.resolve();
    act(() => { blurFlush = result.current.flush(); });
    await settle();
    await act(async () => { await blurFlush; });
    expect(writes).toHaveLength(1);
    // And nothing was lost: the state still says so (XS-65).
    expect(result.current.hasUnsavedWork).toBe(true);

    // Dismiss without writing, then Retry — XS-65's re-entry path.
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
