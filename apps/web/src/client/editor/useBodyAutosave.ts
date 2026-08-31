/**
 * Body autosave (TSK-15) and its concurrency guard (K2).
 *
 * One hook rather than a component so the timing rules are testable
 * without a browser, and so the two editor surfaces (rich and raw)
 * share one save flow rather than each growing its own — the flow doc
 * requires "markdown source mode and WYSIWYG mode share the same
 * backing buffer and save flow".
 */

import type { ErrorResponse } from "@loctt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";

/**
 * Idle delay before an autosave fires.
 *
 * 1.5s is TSK-15's number. Overridable from the page because
 * Playwright's clock control does not reach the platform timer this
 * runs on — the same escape hatch `useSetField` uses for its deadline.
 * A spec that shortened it by mocking timers would be testing the mock.
 */
export const BODY_IDLE_MS = Number(
  (globalThis as { __LOCTT_BODY_IDLE_MS__?: unknown }).__LOCTT_BODY_IDLE_MS__ ?? 1500,
);

/**
 * What the indicator shows (TSK-15's third bullet: the user is never
 * guessing).
 *
 * `unsaved` and `failed` are distinct states, and TSK-48 turns on the
 * difference: after a failed flush the indicator must move to an
 * "explicit unsaved/failed state, not 'saved' and not back to idle".
 * A single boolean cannot say "there are changes because you just
 * typed" apart from "there are changes because the write was refused",
 * and the second needs a message and a retry control.
 */
export type SaveState =
  | { readonly kind: "saved" }
  | { readonly kind: "saving" }
  | { readonly kind: "unsaved" }
  | { readonly kind: "failed"; readonly message: string; readonly detail?: string };

/** A conflict the user has to resolve (XS-12). */
export interface BodyConflict {
  /** The text in the editor — the version the user wrote. */
  readonly mine: string;
  /** The text now on disk — what the other writer put there. */
  readonly theirs: string;
  /** Token for `theirs`, so resolving can carry a fresh precondition. */
  readonly theirToken: string;
}

export interface BodyAutosaveOptions {
  readonly taskRef: string;
  /** Body and token as loaded from `GET /api/tasks/:ref`. */
  readonly loadedBody: string;
  readonly loadedToken: string;
  /** Called after a write lands, so the caller can refresh caches. */
  readonly onSaved?: (nextToken: string) => void;
}

export interface BodyAutosave {
  readonly state: SaveState;
  readonly conflict: BodyConflict | null;
  /** Records a user edit and (re)arms the idle timer. */
  readonly edit: (next: string) => void;
  /** Flush now — blur, Ctrl/Cmd+S, or navigating away. */
  readonly flush: () => Promise<void>;
  /** Retry after a failure, without needing another keystroke. */
  readonly retry: () => Promise<void>;
  /** Resolve a conflict by writing this exact text over `theirs`. */
  readonly resolve: (text: string) => Promise<void>;
  /** Dismiss the conflict surface *without* writing (XS-12). */
  readonly dismissConflict: () => void;
  /** True while there is anything the user would lose by leaving. */
  readonly hasUnsavedWork: boolean;
}

export function useBodyAutosave(opts: BodyAutosaveOptions): BodyAutosave {
  const { taskRef, loadedBody, loadedToken, onSaved } = opts;

  const [state, setState] = useState<SaveState>({ kind: "saved" });
  const [conflict, setConflict] = useState<BodyConflict | null>(null);

  /**
   * The text the user has typed. A ref, not state: the timer callback
   * that fires 1.5s later must read the *latest* text, and a closure
   * over a state variable would send whatever was current when the
   * timer was armed. That is TSK-38's "does not resurrect old text",
   * and it is a bug that only appears under exactly the timing the
   * case describes.
   */
  const bufferRef = useRef(loadedBody);
  /** The last text a write actually put on disk. */
  const savedRef = useRef(loadedBody);
  /** Precondition token for the next write (K2). */
  const tokenRef = useRef(loadedToken);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Serialises writes so two flushes cannot interleave. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  /**
   * A fresh load (navigating to another task, or a refetch) replaces
   * the buffer.
   *
   * TSK-40 forbids task B's editor showing A's buffered content, and
   * the hook is remounted per task by its `key`, but a refetch of the
   * *same* task also lands here. Adopting a new body while the user
   * has unsaved edits would destroy them, so the guard is on the
   * buffer being clean — which is also XS-14's requirement that an
   * idle editor adopt the CLI's change rather than fight it.
   */
  useEffect(() => {
    if (bufferRef.current !== savedRef.current) {
      // Dirty: keep the user's text, but take the new token so the
      // next write is checked against what is now on disk and raises
      // a conflict rather than clobbering it.
      tokenRef.current = loadedToken;
      return;
    }
    bufferRef.current = loadedBody;
    savedRef.current = loadedBody;
    tokenRef.current = loadedToken;
  }, [loadedBody, loadedToken]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * One write. Not called concurrently — `flush` chains through
   * `inFlightRef`.
   */
  /**
   * Set by `resolve` so a conflict resolution writes even when the
   * chosen text equals the last thing this client saved — "keep mine"
   * after a refusal is exactly that case, and the dirty-flag guard
   * below would otherwise swallow it.
   */
  const forceRef = useRef(false);

  const write = useCallback(async (): Promise<void> => {
    const text = bufferRef.current;
    const forced = forceRef.current;
    forceRef.current = false;

    /**
     * XS-14. Nothing to write means no write — full stop.
     *
     * Without this, an idle tab whose buffer equals its last save
     * would still POST on any trigger that reached here, and that
     * request would carry a stale token and land as a conflict the
     * user did nothing to cause. Worse, before the token existed it
     * would have silently restored the old text over a
     * `loctt body --set ""`. Autosave is dirty-flag driven, which is
     * the case's second bullet stated as code.
     */
    if (!forced && text === savedRef.current) {
      setState({ kind: "saved" });
      return;
    }

    setState({ kind: "saving" });
    try {
      const res = await apiClient.post<{ ok: boolean; bodyToken?: string }>(
        `/api/tasks/${encodeURIComponent(taskRef)}/body`,
        { body: text, expectedToken: tokenRef.current },
      );
      savedRef.current = text;
      if (typeof res.bodyToken === "string") tokenRef.current = res.bodyToken;
      onSavedRef.current?.(tokenRef.current);

      /**
       * TSK-38's third bullet: the indicator must not read "saved"
       * while newer unsaved keystrokes exist. The user may well have
       * typed while this request was in flight, so the state depends
       * on the buffer *now*, not on the request having succeeded.
       */
      setState(bufferRef.current === text ? { kind: "saved" } : { kind: "unsaved" });
      // Newer keystrokes arrived mid-flight: re-arm so they get their
      // own save rather than waiting for the user to type again.
      if (bufferRef.current !== text) scheduleRef.current();
    } catch (err) {
      if (err instanceof ApiError && err.envelope?.code === "conflict") {
        setConflict(parseConflict(err.envelope, text));
        /**
         * TSK-48 / ERR-12 / ERR-27: the buffer is untouched. Reverting
         * to `savedRef` here would be the single most destructive
         * thing this hook could do — the user's writing is the only
         * copy of itself.
         */
        setState({
          kind: "failed",
          message: `${taskRef} changed while you were editing. Your text has not been saved.`,
        });
        return;
      }
      setState({ kind: "failed", ...failureCopy(err) });
    }
  }, [taskRef]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    // Chain rather than run in parallel: two overlapping POSTs would
    // race on the server and the older one could land last.
    const prior = inFlightRef.current ?? Promise.resolve();
    const next = prior.then(() => write()).catch(() => undefined);
    inFlightRef.current = next;
    await next;
    if (inFlightRef.current === next) inFlightRef.current = null;
  }, [clearTimer, write]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, BODY_IDLE_MS);
  }, [clearTimer]);

  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  const edit = useCallback((next: string) => {
    bufferRef.current = next;
    /**
     * TSK-15's first bullet — "one save fires, not one per keystroke".
     * Re-arming on every keystroke is what makes the timer *idle*
     * rather than periodic: 30 seconds of continuous typing schedules
     * ~one write, not twenty. Replacing `clearTimeout` with a
     * "schedule only if none pending" check turns it into a
     * fixed-interval save and the timing test goes red.
     */
    setConflict(null);
    setState(next === savedRef.current ? { kind: "saved" } : { kind: "unsaved" });
    if (next !== savedRef.current) scheduleRef.current();
  }, []);

  const retry = useCallback(async () => {
    await flushRef.current();
  }, []);

  /**
   * Write `text` over whatever is on disk, using the token from the
   * conflicting read (XS-12's "keep mine" / "keep both").
   *
   * Still a *conditional* write: a third writer between the refusal
   * and the resolution would otherwise be clobbered by the resolution
   * itself, which is the same bug one level up. It can conflict again,
   * and that is correct.
   */
  const resolve = useCallback(async (text: string) => {
    bufferRef.current = text;
    if (conflict !== null) tokenRef.current = conflict.theirToken;
    setConflict(null);
    // Force the write even if `text` happens to equal the last save.
    savedRef.current = "\0pending";
    await flushRef.current();
  }, [conflict]);

  const dismissConflict = useCallback(() => {
    /**
     * XS-65 / XS-12: dismissing does not write, and does not discard
     * the editor's text. The failure state stays so the user still has
     * a way back to the conflict rather than being left with an
     * editor that looks saved.
     */
    setConflict(null);
    setState({
      kind: "failed",
      message: `${taskRef} changed elsewhere and your text is not saved. Resolve the conflict to keep it.`,
    });
  }, [taskRef]);

  // Flush a pending edit on unmount — navigating away between tasks
  // (TSK-40's "flushed or the user is warned, not silently discarded").
  useEffect(() => () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (bufferRef.current !== savedRef.current) void flushRef.current();
    }
  }, []);

  const hasUnsavedWork =
    state.kind === "unsaved" || state.kind === "failed" || conflict !== null;

  /**
   * TSK-48's fourth bullet and ERR-12: leaving with unsaved text warns.
   * `beforeunload` covers reload and tab close; in-app navigation is
   * covered by the unmount flush above.
   */
  useEffect(() => {
    if (!hasUnsavedWork) return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); };
  }, [hasUnsavedWork]);

  return {
    state, conflict, edit, flush, retry, resolve, dismissConflict, hasUnsavedWork,
  };
}

/** Pulls `theirs` out of the 409 envelope the server sends. */
function parseConflict(envelope: ErrorResponse, mine: string): BodyConflict {
  try {
    const parsed = JSON.parse(envelope.detail ?? "{}") as {
      theirs?: unknown; bodyToken?: unknown;
    };
    return {
      mine,
      theirs: typeof parsed.theirs === "string" ? parsed.theirs : "",
      theirToken: typeof parsed.bodyToken === "string" ? parsed.bodyToken : "",
    };
  } catch {
    return { mine, theirs: "", theirToken: "" };
  }
}

/**
 * Turns a write failure into what the user is told (ERR-12, ERR-27).
 *
 * The server's envelope already names the cause — a full disk arrives
 * as an `io_failed` with ENOSPC in `detail` — so the headline is the
 * server's message rather than a generic "save failed", and the detail
 * rides along for a "Show details" affordance. ERR-12's first bullet
 * requires the disk being full to be *identified*, not reported as a
 * generic write failure, and that identification happens where the
 * errno is: server-side.
 */
function failureCopy(err: unknown): { message: string; detail?: string } {
  if (err instanceof ApiError) {
    const envelope = err.envelope;
    return {
      message: `${envelope?.message ?? err.message} Your text has not been saved.`,
      ...(envelope?.detail !== undefined ? { detail: envelope.detail } : {}),
    };
  }
  return {
    message:
      "The description could not be saved — the server did not respond. "
      + "Your text is still here; copy it out if you need to.",
  };
}
