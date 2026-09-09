/**
 * The task-detail body editor (M2.3), reshaped for K33.
 *
 * ## Read-then-edit (K33, Ken 2026-09-09)
 *
 * The task description is Jira-style read-then-edit, not an always-live
 * editor. This component has two states:
 *
 * - **RENDERED (default):** `BodyRenderedView` shows the body as
 *   read-only formatted output — no toolbar, no mode toggle, no
 *   editable field. Clicking the text enters edit (TSK-69); a click on
 *   a link opens it and a click on an image opens a lightbox, neither
 *   entering edit (TSK-70).
 * - **EDIT:** the surface that used to be the whole component — the
 *   Rich/Markdown mode toggle, `RichEditor`/`MarkdownEditor`, the
 *   `SaveIndicator`, autosave, and `BodyConflictDialog`. The raw/rich
 *   toggle lives HERE, inside edit mode, only.
 *
 * Leaving edit (TSK-71): a blur flushes the idle autosave and returns
 * to the rendered view; Escape cancels and returns to rendered showing
 * the last-saved content. A FAILED save keeps the editor open in its
 * unsaved state (TSK-48) rather than dropping back to a stale render.
 *
 * This SUPERSEDES TSK-64 (toolbar-collapses-until-focus): the whole
 * surface is read-only until entered, so there is no toolbar to
 * collapse in the read state. (`RichEditor` still focus-gates its own
 * toolbar inside edit mode, which is harmless and unchanged.)
 *
 * ## The buffer is still the truth
 *
 * Both edit surfaces read and write one `RichBuffer`, which is what
 * makes TSK-17's round trip a non-operation rather than a
 * re-serialization. The prop contract to `TaskDetail` is unchanged.
 */

import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BodyConflictDialog } from "./BodyConflictDialog.tsx";
import { BodyRenderedView } from "./BodyRenderedView.tsx";
import { RichBuffer } from "./markdown.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { RichEditor } from "./RichEditor.tsx";
import { SaveIndicator } from "./SaveIndicator.tsx";
import { useBodyAutosave } from "./useBodyAutosave.ts";

const PLACEHOLDER = "Describe this task…";

export interface BodyEditorProps {
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

type Mode = "rich" | "raw";

export function BodyEditor({
  taskRef, body, bodyToken, lossyConstructs, mentionCandidates, onSaved,
}: BodyEditorProps): React.JSX.Element {
  /** K33: rendered read state by default; a click enters edit. */
  const [editing, setEditing] = useState(false);

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

  return (
    <BodyEditSurface
      taskRef={taskRef}
      body={body}
      bodyToken={bodyToken}
      lossyConstructs={lossyConstructs}
      mentionCandidates={mentionCandidates}
      {...(onSaved !== undefined ? { onSaved } : {})}
      onLeave={() => { setEditing(false); }}
    />
  );
}

interface EditSurfaceProps extends BodyEditorProps {
  /** Return to the rendered read view (TSK-71). */
  readonly onLeave: () => void;
}

/**
 * The edit state — the pre-K33 always-live editor, now mounted only
 * while `editing`. Split into its own component so the autosave hook,
 * the buffer ref, and the timers exist only during an edit and are torn
 * down (flushing a pending edit — see `useBodyAutosave`'s unmount
 * effect) when the user leaves.
 */
function BodyEditSurface({
  taskRef, body, bodyToken, lossyConstructs, mentionCandidates, onSaved, onLeave,
}: EditSurfaceProps): React.JSX.Element {
  /**
   * B5's guardrail. Footnotes and unregistered raw HTML have no TipTap
   * node, so opening them visually and saving would delete them while
   * reporting success. Detection is server-side (`findLossyConstructs`)
   * so every client applies one rule; this is the half that acts on it.
   */
  const forcedRaw = lossyConstructs.length > 0;
  const [mode, setMode] = useState<Mode>(forcedRaw ? "raw" : "rich");

  const bufferRef = useRef<RichBuffer>(new RichBuffer(body));
  // Mirrors the buffer for rendering only; the buffer is the truth.
  const [text, setText] = useState(body);

  const autosave = useBodyAutosave({
    taskRef,
    loadedBody: body,
    loadedToken: bodyToken,
    ...(onSaved !== undefined ? { onSaved } : {}),
  });

  const { edit, flush, cancel } = autosave;

  // A fresh body from the server (task switch, or an adopted refetch)
  // reseeds the buffer. Guarded on it actually differing so a
  // re-render does not throw away the rich editor's dirty flag.
  useEffect(() => {
    if (bufferRef.current.text === body) return;
    if (bufferRef.current.isRichDirty) return;
    bufferRef.current.reset(body);
    setText(body);
  }, [body]);

  const onRichDoc = useCallback((doc: JSONContent) => {
    bufferRef.current.applyRich(doc);
    const next = bufferRef.current.text;
    setText(next);
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
    edit(next);
  }, [edit]);

  /**
   * Leaving edit returns to the rendered view — but only once the body
   * is safely saved (TSK-71 / TSK-48).
   *
   * A blur/Escape does not decide on the spot whether to leave: the
   * write may still be in flight, and `flush` resolving does not mean
   * React has re-rendered with the settled state. Instead a blur sets
   * `wantsLeave` and flushes; the effect below watches the save state
   * and performs the actual leave once it settles to a clean state.
   * A `failed` write or an open conflict clears `wantsLeave` and keeps
   * the editor open on the unsaved text (TSK-48).
   */
  const [wantsLeave, setWantsLeave] = useState(false);
  useEffect(() => {
    if (!wantsLeave) return;
    // A `failed` write or an open conflict keeps the editor open on the
    // unsaved text (TSK-48).
    if (autosave.state.kind === "failed" || autosave.conflict !== null) {
      setWantsLeave(false);
      return;
    }
    // Leave ONLY once the save has genuinely settled clean — `saved`.
    // `saving` is obviously still in flight; `unsaved` is ALSO still
    // settling here, because `requestLeave` always calls `flush()` first,
    // so a write is on its way (flush runs in a microtask, and React can
    // run this effect on the pre-flush `unsaved` state before `saving`
    // is set). Treating `unsaved` as "clean, safe to leave" unmounted the
    // editor before the POST started, so a failed save landed on an
    // unmounted component and the user's text was lost with no error
    // shown (the TSK-48 violation the fix-review found). Wait for `saved`.
    if (autosave.state.kind !== "saved") return;
    onLeave();
  }, [wantsLeave, autosave.state.kind, autosave.conflict, onLeave]);

  const requestLeave = useCallback(() => {
    setWantsLeave(true);
    void flush();
  }, [flush]);

  /**
   * Ctrl/Cmd+S forces an immediate save (kept from before). Escape
   * cancels the edit and returns to the rendered read view showing the
   * last-saved content (TSK-71). Escape does not flush: it is a cancel,
   * and the rendered view shows the last-saved body.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Cancel (TSK-71): discard the in-editor edit and return to the
        // rendered view showing the LAST-SAVED content. `cancel()` reverts
        // the autosave hook's buffer to the saved baseline and clears the
        // pending idle timer, so the editor's unmount-flush finds nothing
        // dirty and does NOT silently write the edit we are cancelling
        // (the Escape-writes bug the fix-review found). We also revert the
        // local mirror buffer so a re-enter shows the saved body, not the
        // discarded text.
        cancel();
        bufferRef.current.reset(body);
        setText(body);
        onLeave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [flush, cancel, body, onLeave]);

  // Focus the active surface as soon as the editor mounts (TSK-69: the
  // click that entered edit leaves the editor focused, ready to type).
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = wrapperRef.current?.querySelector<HTMLElement>(
      mode === "rich" ? '[data-testid="rich-editor"]' : '[data-testid="markdown-editor"]',
    );
    surface?.focus();
    // Focus only on entering edit / switching surface, never on every
    // keystroke.
  }, [mode]);

  const lossyNote = useMemo(
    () => lossyConstructs.map(c => `${c.kind} (line ${c.line})`).join(", "),
    [lossyConstructs],
  );

  /**
   * A blur that leaves the whole editor (focus moving to something
   * outside this wrapper) flushes and returns to rendered. A blur
   * *within* the wrapper — clicking a toolbar button, switching mode —
   * is not a leave. `relatedTarget` is where focus is going.
   */
  const onWrapperBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    // The conflict dialog is part of the edit flow; a blur while it is
    // open must not tear the editor down — flush is suppressed by the
    // hook while a conflict is open, so just keep the editor.
    if (autosave.conflict !== null) return;
    requestLeave();
  }, [autosave.conflict, requestLeave]);

  return (
    <div data-testid="body-editor" ref={wrapperRef} onBlur={onWrapperBlur}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div role="group" aria-label="Editing mode" className="flex gap-1">
          <button
            type="button"
            data-testid="mode-rich"
            aria-pressed={mode === "rich"}
            disabled={forcedRaw}
            onClick={() => { setMode("rich"); }}
            className={modeClass(mode === "rich", forcedRaw)}
          >
            Rich
          </button>
          <button
            type="button"
            data-testid="mode-raw"
            aria-pressed={mode === "raw"}
            onClick={() => { setMode("raw"); }}
            className={modeClass(mode === "raw", false)}
          >
            Markdown
          </button>
        </div>
        <SaveIndicator state={autosave.state} onRetry={() => { void autosave.retry(); }} />
      </div>

      {forcedRaw && (
        <p
          data-testid="lossy-banner"
          // `aria-live`, not `role="status"` — see SaveIndicator. This
          // banner is also permanently on screen for a lossy body, so
          // it would make `getByRole("status")` ambiguous the same way.
          aria-live="polite"
          className="mb-2 rounded border border-border-subtle bg-bg-muted px-3 py-2 text-[12px] text-text-secondary"
        >
          This task body contains markdown features that can’t be edited
          visually ({lossyNote}). Edit in source mode.
        </p>
      )}

      {mode === "rich" ? (
        <RichEditor
          // Remount when the *task* changes, never on every keystroke —
          // a key tied to the text would rebuild the editor mid-word
          // and cost the user their caret.
          key={taskRef}
          markdown={text}
          onDocChange={onRichDoc}
          onBlur={() => { void flush(); }}
          mentionCandidates={mentionCandidates}
        />
      ) : (
        <MarkdownEditor
          value={text}
          onChange={onRawChange}
          ariaLabel="Description (markdown source)"
          placeholder={PLACEHOLDER}
          className="rounded border border-border-subtle px-3 py-2"
        />
      )}

      {autosave.conflict !== null && (
        <BodyConflictDialog
          taskRef={taskRef}
          conflict={autosave.conflict}
          onResolve={t => { void autosave.resolve(t); }}
          onDismiss={autosave.dismissConflict}
        />
      )}
    </div>
  );
}

function modeClass(active: boolean, disabled: boolean): string {
  return (
    "rounded px-2 py-1 text-[12px] "
    + (disabled
      ? "cursor-not-allowed text-text-tertiary"
      : active
        ? "bg-accent-muted text-text-primary"
        : "text-text-secondary hover:bg-bg-muted")
  );
}
