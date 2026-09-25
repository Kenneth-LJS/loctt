/**
 * The description editor's save flow: explicit Save (K124), the
 * unsaved-draft store (A338), and the concurrency guard (K2).
 *
 * One hook rather than a component so the timing rules are testable
 * without a browser, and so the two editor surfaces (rich and raw)
 * share one save flow rather than each growing its own — the flow doc
 * requires "markdown source mode and WYSIWYG mode share the same
 * backing buffer and save flow".
 *
 * ## What writes, and when (K124, Ken 2026-09-24)
 *
 * Nothing reaches disk — and so nothing reaches the task's history —
 * until the user saves (the Save button, Cmd/Ctrl+Enter, Cmd/Ctrl+S).
 * This replaces TSK-15's 1.5s idle autosave and TSK-71's save-on-blur:
 * Ken, *"a lot of accidental click-outs are happening which saves
 * unintentionally."* The idle timer survives only as the cadence the
 * unsaved text is copied to `sessionStorage` (A338), so a reload does
 * not lose a long edit. The file keeps its name so the diff stays
 * readable; the hook no longer autosaves to disk.
 */

import type { ErrorResponse } from "@loctt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";
import { type BodyDraft, clearBodyDraft, writeBodyDraft } from "./bodyDraft.ts";

/**
 * Idle delay before the unsaved text is copied to the draft store.
 *
 * 1.5s was TSK-15's autosave number; A338 keeps it as the draft
 * cadence. Overridable from the page because Playwright's clock
 * control does not reach the platform timer this runs on — the same
 * escape hatch `useSetField` uses for its deadline.
 */
export const BODY_IDLE_MS = Number(
  (globalThis as { __LOCTT_BODY_IDLE_MS__?: unknown }).__LOCTT_BODY_IDLE_MS__ ?? 1500,
);

/**
 * What the indicator shows: unsaved changes, saving, saved, or failed.
 *
 * `saved` means the editor holds exactly what is on disk — nothing to
 * lose. `unsaved` means there are changes nobody has saved yet (K124:
 * they stay unsaved until the user saves). `unsaved` and `failed` are
 * distinct states, and TSK-48 turns on the difference: after a refused
 * write the indicator must move to an "explicit unsaved/failed state,
 * not 'saved' and not back to idle", and the second needs a message
 * and a retry control.
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
  /** The task's stable id — the draft store is keyed by it (A338). */
  readonly taskId: string;
  /** Body and token as loaded from `GET /api/tasks/:ref`. */
  readonly loadedBody: string;
  readonly loadedToken: string;
  /**
   * A draft restored from `sessionStorage` (A338). Read ONCE, at mount:
   * matching base → the editor opens on the draft, unsaved; a base the
   * file has moved past → the conflict surface opens on it.
   */
  readonly initialDraft?: BodyDraft | null;
  /** Called after a write lands, so the caller can refresh caches. */
  readonly onSaved?: (nextToken: string) => void;
}

export interface BodyAutosave {
  readonly state: SaveState;
  readonly conflict: BodyConflict | null;
  /** Records a user edit; the draft is copied out after the idle window. */
  readonly edit: (next: string) => void;
  /** Save (K124): the only thing that writes to disk. */
  readonly save: () => Promise<void>;
  /** Retry after a failure, without needing another keystroke. */
  readonly retry: () => Promise<void>;
  /**
   * Copy the unsaved text to the draft store now rather than at the end
   * of the idle window (A338: blur, Escape, Cmd/Ctrl+Enter). No-op when
   * nothing is unsaved.
   */
  readonly flushDraft: () => void;
  /** Resolve a conflict by writing this exact text over `theirs`. */
  readonly resolve: (text: string) => Promise<void>;
  /** Dismiss the conflict surface *without* writing (XS-12). */
  readonly dismissConflict: () => void;
  /**
   * Cancel (K124): drop the in-editor text and the draft, returning to
   * what is on disk WITHOUT writing. The caller asks first when there
   * are changes; this is the discard itself.
   *
   * Refused while a Save is in flight (A346): the write cannot be
   * recalled, so there is nothing honest to discard. Returns whether it
   * discarded, so the caller only closes the editor when it did.
   */
  readonly cancel: () => boolean;
  /** True while there is anything the user would lose by leaving. */
  readonly hasUnsavedWork: boolean;
}

/** Where the refs start: the loaded body, or a restored draft (A338). */
interface Seed {
  readonly buffer: string;
  readonly saved: string;
  readonly token: string;
  readonly state: SaveState;
  readonly conflict: BodyConflict | null;
}

function seedFrom(opts: BodyAutosaveOptions): Seed {
  const { taskRef, loadedBody, loadedToken, initialDraft } = opts;
  const clean: Seed = {
    buffer: loadedBody, saved: loadedBody, token: loadedToken,
    state: { kind: "saved" }, conflict: null,
  };
  if (initialDraft === undefined || initialDraft === null) return clean;
  if (initialDraft.text === loadedBody) return clean;
  /**
   * The file has not moved under the draft: restore it silently, unsaved.
   *
   * The body digest is compared as well as the token because the token
   * also covers `updated_at` (core's `bodyToken`), so a status change
   * made in the meta panel moves it without touching the body. A draft
   * whose base body is still exactly what is on disk cannot overwrite
   * anyone's text, and the fresh token makes its Save succeed.
   */
  if (initialDraft.baseToken === loadedToken || initialDraft.baseBody === loadedBody) {
    return {
      buffer: initialDraft.text, saved: loadedBody, token: loadedToken,
      state: { kind: "unsaved" }, conflict: null,
    };
  }
  /**
   * The body changed on disk since the draft was written: the conflict
   * surface, never a silent overwrite (A338, TSK-35's rule). The refs sit
   * exactly where a refused Save leaves them — the old base and its
   * token — so every path out (apply, dismiss then retry, cancel)
   * behaves as it does after a 409.
   */
  return {
    buffer: initialDraft.text,
    saved: initialDraft.baseBody,
    token: initialDraft.baseToken,
    state: {
      kind: "failed",
      message: `${taskRef} changed while you were editing. Your text has not been saved.`,
    },
    conflict: { mine: initialDraft.text, theirs: loadedBody, theirToken: loadedToken },
  };
}

export function useBodyAutosave(opts: BodyAutosaveOptions): BodyAutosave {
  const { taskRef, taskId, loadedBody, loadedToken, onSaved } = opts;

  // The seed is computed once; later prop changes go through the refetch
  // effect below, never back through the draft.
  const [seed] = useState(() => seedFrom(opts));

  const [state, setState] = useState<SaveState>(seed.state);
  const [conflict, setConflictState] = useState<BodyConflict | null>(seed.conflict);

  /**
   * Mirror of `conflict` that `save` can read synchronously (A59).
   *
   * The guard below has to see the dialog close the instant `resolve`
   * closes it — `resolve` clears the conflict and then saves in the
   * same tick, and a state read through a callback closure would still
   * say "open" and swallow the resolution write itself.
   */
  const conflictRef = useRef<BodyConflict | null>(seed.conflict);
  const setConflict = useCallback((c: BodyConflict | null) => {
    conflictRef.current = c;
    setConflictState(c);
  }, []);

  /**
   * The text the user has typed. A ref, not state: a write that lands
   * later must compare against the *latest* text, and a closure over a
   * state variable would see whatever was current when it started.
   * That is TSK-38's "does not resurrect old text".
   */
  const bufferRef = useRef(seed.buffer);
  /** The body the current token refers to — the base the edit is against. */
  const savedRef = useRef(seed.saved);
  /** Precondition token for the next write (K2). */
  const tokenRef = useRef(seed.token);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Serialises writes so two saves cannot interleave. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  /**
   * A fresh load (a refetch — on window focus, the 60s poll, or after
   * any write to the task) lands here.
   *
   * Clean editor: adopt it — XS-14's requirement that an idle editor
   * take the CLI's change rather than fight it.
   *
   * Dirty editor: keep the user's text. Whether to take the new token
   * turns on the BODY, not the token: if the body on disk is still the
   * base this edit started from, only frontmatter moved (a status change
   * in the meta panel bumps `updated_at`, and so the token), and the
   * fresh token lets Save through without a false conflict. If the body
   * itself changed, the old token is kept so Save is refused and the
   * conflict surface opens (XS-11/XS-12). Under K124 an edit can stay
   * open for minutes across a window refocus, so adopting the token
   * unconditionally here — the pre-K124 rule — would let Save silently
   * overwrite a CLI edit made in the meantime.
   */
  useEffect(() => {
    if (bufferRef.current !== savedRef.current || conflictRef.current !== null) {
      if (loadedBody === savedRef.current) tokenRef.current = loadedToken;
      return;
    }
    bufferRef.current = loadedBody;
    savedRef.current = loadedBody;
    tokenRef.current = loadedToken;
  }, [loadedBody, loadedToken]);

  const clearDraftTimer = useCallback(() => {
    if (draftTimerRef.current !== null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, []);

  /**
   * Copy the unsaved text to `sessionStorage` (A338), or clear the
   * draft when there is nothing unsaved. Written from the refs, so it
   * always carries the latest text and the base it is against.
   */
  const flushDraft = useCallback(() => {
    clearDraftTimer();
    if (bufferRef.current === savedRef.current && conflictRef.current === null) return;
    writeBodyDraft(taskIdRef.current, {
      text: bufferRef.current,
      baseToken: tokenRef.current,
      baseBody: savedRef.current,
    });
  }, [clearDraftTimer]);

  /**
   * Set by `resolve` so a conflict resolution writes even when the
   * chosen text equals the base — "keep mine" after a refusal is
   * exactly that case, and the dirty-flag guard below would otherwise
   * swallow it.
   */
  const forceRef = useRef(false);

  /** One write. Not called concurrently — `save` chains through `inFlightRef`. */
  const write = useCallback(async (): Promise<void> => {
    const text = bufferRef.current;
    const forced = forceRef.current;
    forceRef.current = false;

    /**
     * XS-14. Nothing to write means no write — full stop. A Save with no
     * changes (Cmd/Ctrl+Enter on an untouched editor) must not POST a
     * stale buffer carrying a stale token.
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
       * while newer unsaved keystrokes exist. The user may have typed
       * while this request was in flight, so the state depends on the
       * buffer *now*. Those newer keystrokes are not saved for them
       * (K124: only Save writes) — they stay unsaved, and their draft
       * is re-based on what just landed.
       */
      if (bufferRef.current === text) {
        setState({ kind: "saved" });
        clearBodyDraft(taskIdRef.current);
      } else {
        setState({ kind: "unsaved" });
        flushDraft();
      }
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
  }, [taskRef, setConflict, flushDraft]);

  const save = useCallback(async (): Promise<void> => {
    /**
     * A59: while the conflict dialog is open, no write leaves.
     *
     * XS-12's first bullet — "The UI does not write. It presents a
     * conflict resolution surface". The resolution write is not
     * suppressed: `resolve` clears `conflictRef` synchronously before
     * it saves. Every other trigger waits; the buffer keeps the text
     * and `hasUnsavedWork` keeps the warnings armed.
     */
    if (conflictRef.current !== null) return;
    // The draft is current before the write, so a tab that dies with
    // the request in flight still has the text to restore.
    flushDraft();
    // Chain rather than run in parallel: two overlapping POSTs would
    // race on the server and the older one could land last.
    const prior = inFlightRef.current ?? Promise.resolve();
    const next = prior.then(() => write()).catch(() => undefined);
    inFlightRef.current = next;
    await next;
    if (inFlightRef.current === next) inFlightRef.current = null;
  }, [flushDraft, write]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const edit = useCallback((next: string) => {
    bufferRef.current = next;
    setConflict(null);
    if (next === savedRef.current) {
      // Typed back to what is on disk: nothing unsaved, nothing to keep.
      clearDraftTimer();
      clearBodyDraft(taskIdRef.current);
      setState({ kind: "saved" });
      return;
    }
    setState({ kind: "unsaved" });
    /**
     * The draft copy is idle-debounced (A338 keeps TSK-15's cadence):
     * re-armed on every keystroke, so continuous typing writes one draft
     * at the end, not one per key. Nothing here touches the server.
     */
    clearDraftTimer();
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      flushDraft();
    }, BODY_IDLE_MS);
  }, [setConflict, clearDraftTimer, flushDraft]);

  const retry = useCallback(async () => {
    await saveRef.current();
  }, []);

  /**
   * Cancel (K124): discard the in-editor text and the draft, returning
   * to the base WITHOUT writing. Setting `bufferRef` back to `savedRef`
   * is what makes every later exit (unmount, beforeunload) see a clean
   * editor, so a cancelled edit cannot come back as a draft.
   *
   * A346: a Save already in flight wins. Resetting the buffer under it
   * made the landed write look like newer keystrokes, and the old text
   * came back as a draft against the new token. The editor disables
   * Cancel and Escape while saving; this is the same rule where the
   * refs live, for the moment before the indicator reads "saving".
   */
  const cancel = useCallback((): boolean => {
    if (inFlightRef.current !== null) return false;
    clearDraftTimer();
    forceRef.current = false;
    bufferRef.current = savedRef.current;
    setConflict(null);
    setState({ kind: "saved" });
    clearBodyDraft(taskIdRef.current);
    return true;
  }, [clearDraftTimer, setConflict]);

  /**
   * Apply a conflict resolution (XS-12's "keep mine" / "keep theirs" /
   * "keep both").
   *
   * A text other than `theirs` is written using the token from the
   * conflicting read. Still a *conditional* write: a third writer
   * between the refusal and the resolution would otherwise be clobbered
   * by the resolution itself, which is the same bug one level up.
   *
   * "Keep theirs" writes nothing: the promised result — the disk
   * version — is already on disk, and a write of identical text would
   * only add a history entry for a change nobody made (K124).
   */
  const resolve = useCallback(async (text: string) => {
    const open = conflictRef.current;
    if (open !== null && text === open.theirs) {
      clearDraftTimer();
      bufferRef.current = open.theirs;
      savedRef.current = open.theirs;
      tokenRef.current = open.theirToken;
      setConflict(null);
      setState({ kind: "saved" });
      clearBodyDraft(taskIdRef.current);
      onSavedRef.current?.(open.theirToken);
      return;
    }
    bufferRef.current = text;
    if (open !== null) tokenRef.current = open.theirToken;
    setConflict(null);
    forceRef.current = true;
    await saveRef.current();
  }, [clearDraftTimer, setConflict]);

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
  }, [taskRef, setConflict]);

  /**
   * Unmount writes NOTHING to disk (K124) — the pre-K124 unmount flush
   * (A246) is gone with autosave. It copies unsaved text to the draft
   * instead, so an unmount no guard saw (the task view torn down by
   * something other than a navigation) keeps the text for this tab.
   * A338: the draft is never *cleared* on unmount alone.
   */
  useEffect(() => () => {
    if (draftTimerRef.current !== null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    if (bufferRef.current !== savedRef.current || conflictRef.current !== null) {
      writeBodyDraft(taskIdRef.current, {
        text: bufferRef.current,
        baseToken: tokenRef.current,
        baseBody: savedRef.current,
      });
    }
  }, []);

  const hasUnsavedWork =
    state.kind === "unsaved" || state.kind === "failed" || conflict !== null;

  /**
   * TSK-48's fourth bullet and K124: leaving with unsaved text warns.
   * `beforeunload` covers reload and tab close; in-app navigation is
   * covered by the router guard (`useUnsavedGuard`, wired in
   * `BodyEditSurface`). The draft is flushed here too (A338), so a
   * reload the user confirms comes back to the text.
   */
  useEffect(() => {
    if (!hasUnsavedWork) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      flushDraft();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); };
  }, [hasUnsavedWork, flushDraft]);

  return {
    state, conflict, edit, save, retry, flushDraft, resolve, dismissConflict, cancel, hasUnsavedWork,
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
    message: "Description not saved.",
  };
}
