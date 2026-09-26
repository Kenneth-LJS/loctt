/**
 * The task-detail body editor (M2.3), reshaped for K33 and K124.
 *
 * ## Read-then-edit (K33, Ken 2026-09-09)
 *
 * The task description is Jira-style read-then-edit, not an always-live
 * editor. This component has two states:
 *
 * - **RENDERED (default):** `BodyRenderedView` shows the body as
 *   read-only formatted output — no toolbar, no mode toggle, no
 *   editable field. The Edit button enters edit (A247); a click on a
 *   link opens it and a click on an image opens a lightbox (TSK-70).
 * - **EDIT:** the Rich/Markdown mode toggle, `RichEditor`/
 *   `MarkdownEditor`, the `SaveIndicator`, the Save/Cancel row and
 *   `BodyConflictDialog`. The raw/rich toggle lives HERE only.
 *
 * ## Save and Cancel (K124, Ken 2026-09-24)
 *
 * *"once in editing mode, i think there should be a save button to
 * save, and cancel. in which case, things dont get saved and history
 * isnt updated. because right now, a lot of accidental click-outs are
 * happening which saves unintentionally."*
 *
 * - **Save** (the button, Cmd/Ctrl+Enter, Cmd/Ctrl+S) is the only thing
 *   that writes. A write that lands returns to the rendered view; a
 *   failed or refused one keeps the editor open on the text (TSK-48,
 *   XS-12).
 * - **Clicking away** neither saves nor discards: the editor stays open.
 * - **Cancel** and **Escape** discard and close, asking "Discard
 *   changes?" first when there are changes. This replaces K96's "Escape
 *   exits keeping the text".
 * - **Leaving the page** with changes warns: `beforeunload` for reload
 *   and tab close, `useUnsavedGuard` (the same discard prompt) for an
 *   in-app navigation.
 * - **Drafts (A338):** unsaved text is kept in `sessionStorage` for this
 *   tab. Reopening the task with a draft restores it into edit mode, or
 *   opens the conflict surface if the body changed on disk since.
 *
 * ## The buffer is still the truth
 *
 * Both edit surfaces read and write one `RichBuffer`, which is what
 * makes TSK-17's round trip a non-operation rather than a
 * re-serialization.
 */

import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUnsavedGuard } from "../router/useUnsavedGuard.ts";
import { Button } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { BodyConflictDialog } from "./BodyConflictDialog.tsx";
import { type BodyDraft, clearBodyDraft, readBodyDraft } from "./bodyDraft.ts";
import { BodyRenderedView } from "./BodyRenderedView.tsx";
import { RichBuffer } from "./markdown.ts";
import type { EditorMode } from "./MarkdownField.tsx";
import { MarkdownField } from "./MarkdownField.tsx";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { SaveIndicator } from "./SaveIndicator.tsx";
import { useBodyAutosave } from "./useBodyAutosave.ts";

const PLACEHOLDER = "Describe this task…";

export interface BodyEditorProps {
  /** The task's stable id (ULID). Keys the unsaved draft (A338). */
  readonly taskId: string;
  readonly taskRef: string;
  readonly body: string;
  readonly bodyToken: string;
  /**
   * Constructs the visual editor cannot represent (B5). Non-empty
   * forces raw mode for this body.
   */
  readonly lossyConstructs: readonly { readonly kind: string; readonly line: number }[];
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly onSaved?: (token: string) => void;
}

export function BodyEditor(props: BodyEditorProps): React.JSX.Element {
  const { taskId, body, mentionCandidates } = props;

  /**
   * A338: a draft left by this tab (a reload mid-edit) reopens the
   * editor on it. Read once, at mount. A draft identical to what is on
   * disk carries nothing to restore, so it is dropped rather than
   * opening an editor with no changes in it.
   */
  const [draft, setDraft] = useState<BodyDraft | null>(() => {
    const found = readBodyDraft(taskId);
    if (found !== null && found.text === body) {
      clearBodyDraft(taskId);
      return null;
    }
    return found;
  });

  /** K33: rendered read state by default; the Edit button enters edit. */
  const [editing, setEditing] = useState(draft !== null);

  const onLeave = useCallback(() => {
    setEditing(false);
    // The draft seeded one edit session; re-entering edit starts fresh.
    setDraft(null);
  }, []);

  if (!editing) {
    return (
      <BodyRenderedView
        body={body}
        placeholder={PLACEHOLDER}
        mentionCandidates={mentionCandidates}
        onEnterEdit={() => { setEditing(true); }}
      />
    );
  }

  return <BodyEditSurface {...props} initialDraft={draft} onLeave={onLeave} />;
}

interface EditSurfaceProps extends BodyEditorProps {
  readonly initialDraft: BodyDraft | null;
  /** Return to the rendered read view. */
  readonly onLeave: () => void;
}

/** The discard prompt's pending decision: `true` discards, `false` keeps editing. */
type PendingDiscard = { readonly decide: (discard: boolean) => void } | null;

/**
 * The edit state, mounted only while `editing`. Split into its own
 * component so the save hook, the buffer ref and the draft timer exist
 * only during an edit.
 */
function BodyEditSurface({
  taskId, taskRef, body, bodyToken, lossyConstructs, mentionCandidates, onSaved,
  initialDraft, onLeave,
}: EditSurfaceProps): React.JSX.Element {
  /**
   * B5's guardrail. Footnotes and unregistered raw HTML have no TipTap
   * node, so opening them visually and saving would delete them while
   * reporting success. Detection is server-side (`findLossyConstructs`)
   * so every client applies one rule; this is the half that acts on it.
   */
  const forcedRaw = lossyConstructs.length > 0;
  const [mode, setMode] = useState<EditorMode>(forcedRaw ? "raw" : "rich");

  // A restored draft is what the editor opens on (A338).
  const openingText = initialDraft?.text ?? body;
  const bufferRef = useRef<RichBuffer>(new RichBuffer(openingText));
  // Mirrors the buffer for rendering only; the buffer is the truth.
  const [text, setText] = useState(openingText);

  const autosave = useBodyAutosave({
    taskRef,
    taskId,
    loadedBody: body,
    loadedToken: bodyToken,
    initialDraft,
    ...(onSaved !== undefined ? { onSaved } : {}),
  });

  const { state, conflict, edit, save, flushDraft, cancel, hasUnsavedWork } = autosave;

  /**
   * A fresh body from the server (an adopted refetch) reseeds the
   * buffer — but only while there is nothing unsaved. With unsaved text
   * (typed, restored from a draft, or refused) the refetch must not
   * replace what the user sees: the hook keeps their text, and so does
   * the surface. The same guard the hook applies (XS-14).
   *
   * A Save in flight counts as unsaved here (A346): `hasUnsavedWork` is
   * false while saving, and a refetch landing then used to swap in the
   * other writer's text while the hook's buffer (and a 409's "mine")
   * still held the user's.
   */
  useEffect(() => {
    if (hasUnsavedWork || state.kind === "saving") return;
    if (bufferRef.current.text === body) return;
    if (bufferRef.current.isRichDirty) return;
    bufferRef.current.reset(body);
    setText(body);
    // Keyed on the body only: this reacts to a refetch, not to typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  /**
   * Set by an explicit save gesture (Save, Retry, a conflict's Apply);
   * the editor leaves once that write has landed clean. Cleared by the
   * next keystroke, so typing back to the saved text never closes the
   * editor on its own.
   */
  const [awaitingWrite, setAwaitingWrite] = useState(false);

  const onRichDoc = useCallback((doc: JSONContent) => {
    bufferRef.current.applyRich(doc);
    const next = bufferRef.current.text;
    setText(next);
    setAwaitingWrite(false);
    edit(next);
  }, [edit]);

  const onRawChange = useCallback((next: string) => {
    /**
     * A raw edit makes the typed bytes the new baseline. TSK-17's
     * fourth bullet — "what is stored is what was typed in raw mode" —
     * depends on this: `reset` clears the dirty flag, so a subsequent
     * toggle to rich and back returns these exact bytes rather than a
     * serialization of them.
     */
    bufferRef.current.reset(next);
    setText(next);
    setAwaitingWrite(false);
    edit(next);
  }, [edit]);

  /**
   * Leave only once the write has genuinely settled clean — `saved`.
   *
   * `unsaved` is still settling here: `requestSave` sets the flag and
   * calls `save()`, whose write starts in a microtask, so React can run
   * this effect on the pre-write `unsaved` state. Leaving then unmounted
   * the editor before the POST started, and a failing save landed on an
   * unmounted component with the text lost (the TSK-48 race). A `failed`
   * write or an open conflict keeps the editor open on the text.
   */
  useEffect(() => {
    if (!awaitingWrite) return;
    if (state.kind !== "saved" || conflict !== null) return;
    onLeave();
  }, [awaitingWrite, state.kind, conflict, onLeave]);

  /** Save (K124). With nothing to save it simply closes. */
  const requestSave = useCallback(() => {
    if (!hasUnsavedWork) {
      onLeave();
      return;
    }
    setAwaitingWrite(true);
    void save();
  }, [hasUnsavedWork, onLeave, save]);

  /** The "Discard changes?" prompt, shared by Cancel/Escape and navigation. */
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard>(null);

  const saving = state.kind === "saving";

  /**
   * Cancel / Escape (K124): discard and close, asking first if there are changes.
   *
   * Unavailable while a Save is in flight (A346): the write cannot be
   * recalled, so offering to discard it would be a lie. `cancel` refuses
   * too, and the editor only closes when it actually discarded.
   */
  const requestCancel = useCallback(() => {
    if (saving) return;
    flushDraft();
    if (!hasUnsavedWork) {
      if (cancel()) onLeave();
      return;
    }
    setPendingDiscard({
      decide: discard => {
        setPendingDiscard(null);
        if (!discard) return;
        if (cancel()) onLeave();
      },
    });
  }, [saving, flushDraft, hasUnsavedWork, cancel, onLeave]);

  /**
   * An in-app navigation with unsaved changes asks the same question
   * (K124: "warn before leaving"). Discard lets the navigation through
   * with the draft dropped; Keep editing blocks it and leaves the editor
   * exactly as it was. Nothing is written either way.
   */
  const confirmNavigation = useCallback(() => new Promise<boolean>(resolve => {
    flushDraft();
    setPendingDiscard({
      decide: discard => {
        setPendingDiscard(null);
        if (discard) cancel();
        resolve(discard);
      },
    });
  }), [flushDraft, cancel]);

  useUnsavedGuard({ hasUnsavedWork, onNavigateAway: confirmNavigation });

  const wrapperRef = useRef<HTMLDivElement>(null);

  /**
   * Keyboard (K124). Scoped to the editor's own subtree, like the
   * comment composer's Escape: with click-away no longer closing the
   * editor, focus can be anywhere on the page while it stays open, and
   * an Escape meant for the status picker must not prompt a discard.
   *
   * - Cmd/Ctrl+Enter and Cmd/Ctrl+S save. Captured, so the rich
   *   editor's own Mod-Enter (a hard break) never inserts a line into
   *   the text being saved.
   * - Escape cancels. It yields to any overlay that owns it: the
   *   conflict dialog and the mention menu (both capture it on the
   *   document first), and an open menu or picker panel (portalled, and
   *   closing on the same key).
   */
  useEffect(() => {
    const node = wrapperRef.current;
    if (node === null) return undefined;
    const onSaveKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "Enter" && e.key.toLowerCase() !== "s") return;
      if (conflict !== null) return;
      e.preventDefault();
      e.stopPropagation();
      flushDraft();
      requestSave();
    };
    const onEscape = (e: KeyboardEvent): void => {
      // Not gated on `defaultPrevented`: ProseMirror prevents the default
      // of EVERY Escape keydown in the rich surface (prosemirror-view's
      // `captureKeyDown`, keyCode 27), so such a gate made Escape dead in
      // the editor it is meant for. Overlays that own Escape stop its
      // propagation or are detected below instead.
      if (e.key !== "Escape") return;
      if (conflict !== null) return;
      if (document.querySelector('[data-testid="mention-menu"]') !== null) return;
      if (document.querySelector("[data-portal-panel]") !== null) return;
      e.preventDefault();
      e.stopPropagation();
      requestCancel();
    };
    node.addEventListener("keydown", onSaveKey, true);
    node.addEventListener("keydown", onEscape);
    return () => {
      node.removeEventListener("keydown", onSaveKey, true);
      node.removeEventListener("keydown", onEscape);
    };
  }, [conflict, flushDraft, requestSave, requestCancel]);

  // Focus the active surface as soon as the editor mounts (TSK-69: the
  // gesture that entered edit leaves the editor focused, ready to type).
  useEffect(() => {
    if (mode === "rich") {
      // A247 removed click-to-edit, so nothing else focuses the rich
      // surface on entry; without this the user had to click a second
      // time before they could type.
      const richId = requestAnimationFrame(() => {
        wrapperRef.current
          ?.querySelector<HTMLElement>('[data-testid="rich-editor"]')
          ?.focus();
      });
      return () => { cancelAnimationFrame(richId); };
    }
    // Raw mode: focus CodeMirror's editable `.cm-content`, deferred to
    // the next frame so the view has mounted its content element.
    const id = requestAnimationFrame(() => {
      const cm = wrapperRef.current?.querySelector<HTMLElement>(
        '[data-testid="markdown-editor"] .cm-content',
      );
      cm?.focus();
    });
    return () => { cancelAnimationFrame(id); };
    // Focus only on entering edit / switching surface, never on every
    // keystroke.
  }, [mode]);

  const lossyNote = useMemo(
    () => lossyConstructs.map(c => `${c.kind} (line ${c.line})`).join(", "),
    [lossyConstructs],
  );

  /**
   * Focus leaving the editor copies the unsaved text to the draft store
   * (A338) — and does nothing else. K124: clicking away neither saves
   * nor discards; the editor stays open until Save or Cancel.
   */
  const onWrapperBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    flushDraft();
  }, [flushDraft]);

  const changed = state.kind === "unsaved" || state.kind === "failed";

  return (
    <>
      <div
        data-testid="body-editor"
        ref={wrapperRef}
        onBlur={onWrapperBlur}
        // `-mx-3` mirrors the read view (BodyRenderedView): the framed edit
        // box extends 12px into the section gutter on both sides so the
        // editor's own px-3 content padding lands the text flush-left with
        // the section label — entering edit does not shift the body text
        // horizontally.
        className="-mx-3 space-y-2"
      >
        <div className="rounded border border-border-subtle">
          {/* The shared editing chrome (MarkdownField): the same icon
              toolbar, mode toggle, and rich/source surfaces the comment
              composer uses. What is specific to the description — the mode
              toggle's bare testids, the SaveIndicator in the trailing slot,
              the lossy banner — is passed as props, not forked. */}
          <MarkdownField
            mode={mode}
            onModeChange={setMode}
            forcedRaw={forcedRaw}
            text={text}
            onRichDoc={onRichDoc}
            onRawChange={onRawChange}
            mentionCandidates={mentionCandidates}
            // Remount the rich surface when the *task* changes, never on
            // every keystroke — a key tied to the text would rebuild the
            // editor mid-word and cost the user their caret.
            richEditorKey={taskRef}
            ariaLabel="Description"
            placeholder={PLACEHOLDER}
            toolbarTrailing={
              <SaveIndicator
                state={state}
                onRetry={() => { setAwaitingWrite(true); void autosave.retry(); }}
              />
            }
            banner={forcedRaw
              ? (
                  <p
                    data-testid="lossy-banner"
                    // `aria-live`, not `role="status"` — see SaveIndicator.
                    // This banner is also permanently on screen for a lossy
                    // body, so it would make `getByRole("status")` ambiguous
                    // the same way.
                    aria-live="polite"
                    className="mb-2 rounded border border-border-subtle bg-bg-muted px-3 py-2 text-[0.8571rem] text-text-secondary"
                  >
                    This task body contains markdown features that can’t be edited
                    visually ({lossyNote}). Edit in source mode.
                  </p>
                )
              : undefined}
          />
        </div>

        {/* The action row, under the editor — the comment composer's
            Comment/Cancel layout: primary first, secondary after. */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            testId="body-save"
            disabled={!changed}
            loading={saving}
            // `loading` hides the visible label; the name stays "Save".
            aria-label="Save"
            onClick={requestSave}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            testId="body-cancel"
            disabled={saving}
            onClick={requestCancel}
          >
            Cancel
          </Button>
        </div>

        {conflict !== null && (
          <BodyConflictDialog
            taskRef={taskRef}
            conflict={conflict}
            onResolve={t => { setAwaitingWrite(true); void autosave.resolve(t); }}
            onDismiss={autosave.dismissConflict}
          />
        )}
      </div>

      {/* Outside the editor's subtree on purpose: the dialog's own Escape
          ("Keep editing") must not bubble into the editor's Escape handler
          and re-open the prompt it just closed. */}
      {pendingDiscard !== null && (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          testId="body-discard-dialog"
          confirmTestId="body-discard-confirm"
          cancelTestId="body-discard-keep"
          onConfirm={() => { pendingDiscard.decide(true); }}
          onCancel={() => { pendingDiscard.decide(false); }}
        />
      )}
    </>
  );
}
