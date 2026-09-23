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
 * Leaving edit (TSK-71, K96): a blur, Escape, or Cmd/Ctrl+Enter flushes
 * the pending edit and returns to the rendered view KEEPING the text —
 * there is no discard gesture (K96). A FAILED save keeps the editor open
 * in its unsaved state (TSK-48) rather than dropping back to a stale
 * render.
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

import { useUnsavedGuard } from "../router/useUnsavedGuard.ts";
import { BodyConflictDialog } from "./BodyConflictDialog.tsx";
import { BodyRenderedView } from "./BodyRenderedView.tsx";
import { RichBuffer } from "./markdown.ts";
import type { EditorMode } from "./MarkdownField.tsx";
import { MarkdownField } from "./MarkdownField.tsx";
import type { MentionCandidate } from "./MentionMenu.tsx";
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

export function BodyEditor({
  taskRef, body, bodyToken, lossyConstructs, mentionCandidates, onSaved,
}: BodyEditorProps): React.JSX.Element {
  /** K33: rendered read state by default; the Edit button enters edit. */
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
  const [mode, setMode] = useState<EditorMode>(forcedRaw ? "raw" : "rich");

  const bufferRef = useRef<RichBuffer>(new RichBuffer(body));
  // Mirrors the buffer for rendering only; the buffer is the truth.
  const [text, setText] = useState(body);

  const autosave = useBodyAutosave({
    taskRef,
    loadedBody: body,
    loadedToken: bodyToken,
    ...(onSaved !== undefined ? { onSaved } : {}),
  });

  const { edit, flush, flushForNav, hasUnsavedWork } = autosave;

  /**
   * A246: in-app navigation while the body is dirty/failed is intercepted
   * by the router. It flushes first; the route change proceeds only if
   * the flush lands clean. A refused write blocks the navigation and
   * keeps this edit surface mounted, so its SaveIndicator /
   * BodyConflictDialog stay on screen rather than the route tearing the
   * editor down and losing the text silently. This mirrors the
   * `beforeunload` guard (tab close / reload) for the in-app-nav exit.
   */
  useUnsavedGuard({ hasUnsavedWork, onNavigateAway: flushForNav });

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
   * Keyboard exits (K96, Ken 2026-09-19). The editor autosaves and there
   * is no "discard my edits" gesture: Escape, Cmd/Ctrl+Enter, and
   * Cmd/Ctrl+S all EXIT KEEPING the text — they flush the pending edit and
   * return to the rendered read view once the save settles. This replaces
   * the old Escape-cancels-to-last-save behaviour, which reverted to the
   * last autosave and so silently discarded everything typed in the idle
   * window since (the data-loss bug the editor review found). `cancel()` is
   * no longer used here.
   *
   * Escape must not steal the key from an overlay that owns it: when the
   * mention menu or the conflict dialog is open, Escape belongs to that
   * overlay (it closes the menu / dismisses the dialog). Those overlays
   * stop propagation when they handle it, but we also guard here so a
   * capture-phase ordering difference can never turn "close the menu" into
   * "leave the editor".
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const save = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      const cmdEnter = (e.metaKey || e.ctrlKey) && e.key === "Enter";
      const esc = e.key === "Escape";
      if (!save && !cmdEnter && !esc) return;

      // An open overlay owns Escape; leave the editor alone.
      if (esc && autosave.conflict !== null) return;
      if (esc && wrapperRef.current?.querySelector('[data-testid="mention-menu"]')) return;

      e.preventDefault();
      // Cmd/Ctrl+S is a plain force-save that stays in the editor; Escape
      // and Cmd/Ctrl+Enter flush and leave, keeping the text.
      if (save) { void flush(); return; }
      requestLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [flush, requestLeave, autosave.conflict]);

  // Focus the active surface as soon as the editor mounts (TSK-69: the
  // click that entered edit leaves the editor focused, ready to type).
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "rich") {
      // The rich surface used to focus ITSELF: `RichEditor`'s
      // caret-at-coords effect placed the caret where the user clicked
      // the rendered body. A247 removed click-to-edit (a click target
      // wrapping the description also wraps its links and images —
      // nested-interactive, WCAG 4.1.2), so there are no coords to place
      // a caret at and nothing focused the editor at all. Entering edit
      // left focus on the "Edit" button, and the user had to click a
      // second time before they could type — TSK-69's "ready to type"
      // stopped being true when the gesture it assumed went away.
      const richId = requestAnimationFrame(() => {
        wrapperRef.current
          ?.querySelector<HTMLElement>('[data-testid="rich-editor"]')
          ?.focus();
      });
      return () => { cancelAnimationFrame(richId); };
    }
    // Raw mode: the host `<div data-testid="markdown-editor">` is not
    // itself focusable — focus CodeMirror's editable `.cm-content`
    // instead, which is what accepts typing. Deferred to the next frame
    // so the view has mounted its content element.
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
   * A blur that leaves the whole editor (focus moving to something
   * outside this wrapper) flushes and returns to rendered. A blur
   * *within* the wrapper — clicking a toolbar button, switching mode —
   * is not a leave. `relatedTarget` is where focus is going.
   */
  const onWrapperBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    // A dropdown this editor owns (the block-type picker) PORTALS its
    // panel to `document.body`, so focus moving into it is not "within
    // the wrapper" even though it is within the editor's own UI. Without
    // this, opening the block-type dropdown tore the editor down and the
    // transform never applied (TSK-59) — a regression from K106 step 2's
    // portal migration, whose blast radius reached past the dropdown
    // call sites to every component that used containment to mean
    // "still mine".
    const related = e.relatedTarget as Element | null;
    if (related?.closest("[data-portal-panel]") != null) return;
    // The conflict dialog is part of the edit flow; a blur while it is
    // open must not tear the editor down — flush is suppressed by the
    // hook while a conflict is open, so just keep the editor.
    if (autosave.conflict !== null) return;
    requestLeave();
  }, [autosave.conflict, requestLeave]);

  return (
    <div
      data-testid="body-editor"
      ref={wrapperRef}
      onBlur={onWrapperBlur}
      // `-mx-3` mirrors the read view (BodyRenderedView): the framed edit
      // box extends 12px into the section gutter on both sides so the
      // editor's own px-3 content padding lands the text flush-left with
      // the section label — entering edit does not shift the body text
      // horizontally.
      className="-mx-3 rounded border border-border-subtle"
    >
      {/* The shared editing chrome (MarkdownField): the same always-visible
          icon toolbar, mode toggle, and rich/source surfaces the comment
          composer uses. What is specific to the description — the mode
          toggle's bare testids, the SaveIndicator in the trailing slot, the
          lossy banner, autosave-on-blur, and the caret-at-click — is passed
          as props, not forked. */}
      <MarkdownField
        mode={mode}
        onModeChange={setMode}
        forcedRaw={forcedRaw}
        text={text}
        onRichDoc={onRichDoc}
        onRawChange={onRawChange}
        mentionCandidates={mentionCandidates}
        // Remount the rich surface when the *task* changes, never on every
        // keystroke — a key tied to the text would rebuild the editor
        // mid-word and cost the user their caret.
        richEditorKey={taskRef}
        ariaLabel="Description"
        placeholder={PLACEHOLDER}
        onRichBlur={() => { void flush(); }}
        toolbarTrailing={
          <SaveIndicator state={autosave.state} onRetry={() => { void autosave.retry(); }} />
        }
        banner={forcedRaw
          ? (
              <p
                data-testid="lossy-banner"
                // `aria-live`, not `role="status"` — see SaveIndicator. This
                // banner is also permanently on screen for a lossy body, so
                // it would make `getByRole("status")` ambiguous the same way.
                aria-live="polite"
                className="mb-2 rounded border border-border-subtle bg-bg-muted px-3 py-2 text-[0.8571rem] text-text-secondary"
              >
                This task body contains markdown features that can’t be edited
                visually ({lossyNote}). Edit in source mode.
              </p>
            )
          : undefined}
      />

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
