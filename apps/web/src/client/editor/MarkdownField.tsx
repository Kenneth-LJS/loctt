/**
 * The one editing shell both markdown editors render (Ken: "why aren't we
 * making it the same component?").
 *
 * ## Why this exists
 *
 * The task description (`BodyEditor`) and the comment composer
 * (`CommentComposer`) are two markdown editors that had drifted: the
 * description got the always-on icon toolbar with tooltips + a mobile
 * "More" overflow + the `</>` mode toggle, while the comment kept an
 * older focus-gated text-label toolbar and a "Rich"/"Markdown" text
 * toggle. They diverged because they were NOT the same component — each
 * re-implemented its own orchestration around the shared low-level
 * `RichEditor`/`MarkdownEditor`/`RichBuffer`.
 *
 * `MarkdownField` is the shared EDITING CHROME: the mode toggle, the
 * always-visible responsive icon `Toolbar` (with its mobile overflow),
 * the rich-vs-source surfaces, and mention support. Both callers render
 * it, so the two editors are identical by construction rather than by
 * two lists of matching classes.
 *
 * ## What stays with the caller
 *
 * The chrome is shared; the *behaviour around* it is not, and that is
 * the point of the prop contract:
 *
 *  - **The buffer is the caller's.** `MarkdownField` never owns a
 *    `RichBuffer` — the description autosaves it, the composer submits
 *    it, and each seeds/resets it differently (a task switch vs. a
 *    post-clears-and-refocuses remount). The caller passes `text` and
 *    the two write callbacks (`onRichDoc`, `onRawChange`) that feed its
 *    own buffer; the shell only renders and routes keystrokes.
 *  - **`mode` is controlled** so the caller can force raw for a lossy
 *    body (B5) or open an edit in source mode (CMT-3).
 *  - **`footer`** is a slot: the composer puts its submit/cancel row
 *    there; the description leaves it empty (it autosaves).
 *  - **`toolbarTrailing`** is rendered beside the toolbar: the
 *    description's `SaveIndicator` lives there.
 *  - **`banner`** renders between the toolbar and the surface: the
 *    description's lossy-constructs notice.
 *
 * Everything above the buffer — the autosave hook, the K96 exit
 * gesture, the conflict dialog, the submit button — stays in the two
 * callers, unchanged.
 */

import type { Editor, JSONContent } from "@tiptap/core";
import { useCallback, useRef, useState } from "react";

import { MarkdownEditor } from "./MarkdownEditor.tsx";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { RichEditor } from "./RichEditor.tsx";
import { Toolbar } from "./Toolbar.tsx";

export type EditorMode = "rich" | "raw";

export interface MarkdownFieldProps {
  readonly mode: EditorMode;
  readonly onModeChange: (mode: EditorMode) => void;
  /** Locks the toggle to raw and disables the rich half (lossy body, B5). */
  readonly forcedRaw?: boolean;

  /** The markdown mirror of the caller's `RichBuffer` (the truth). */
  readonly text: string;
  /** A real rich-document change (never a selection move). */
  readonly onRichDoc: (doc: JSONContent) => void;
  /** A raw-source edit. */
  readonly onRawChange: (next: string) => void;

  readonly mentionCandidates: readonly MentionCandidate[];

  /** The rich surface's `data-testid`, distinct per editor (TSK-67). */
  readonly richEditorTestId?: string;
  /**
   * The mode toggle's testid stem — the description keeps the bare
   * `mode-rich`/`mode-raw`; the composer scopes it to avoid a collision
   * with the description editor on the same page.
   */
  readonly modeTestIdPrefix?: string;

  readonly ariaLabel?: string;
  readonly placeholder?: string;

  /**
   * Remount key for the rich surface — a task ref for the description
   * (never on keystroke), a reset token for the composer.
   */
  readonly richEditorKey?: string;
  /** The rich surface blurred (the description flushes; the composer no-ops). */
  readonly onRichBlur?: () => void;
  /** The viewport point that entered edit, so the caret lands there (TSK-69). */
  readonly focusCoords?: { readonly x: number; readonly y: number };
  /** Handed the live TipTap editor so the shared toolbar can drive it. */
  readonly onEditorReady?: (editor: Editor | null) => void;

  /**
   * When present, the toolbar shows an Attach button and the file picker
   * it opens hands the chosen files here. The caller uploads them to the
   * ticket's attachment store and inserts the embed into its buffer — the
   * shell only surfaces the affordance (GOAL 2). Absent → no Attach button.
   */
  readonly onAttachFiles?: (files: readonly File[]) => void;
  readonly attachPending?: boolean;
  /** File `accept` filter for the picker; defaults to all files. */
  readonly attachAccept?: string;
  /** The hidden file input's `data-testid` (defaults to `attach-input`). */
  readonly attachInputTestId?: string;

  /** Rendered beside the toolbar (the description's SaveIndicator). */
  readonly toolbarTrailing?: React.ReactNode;
  /** Rendered between the toolbar and the surface (the lossy banner). */
  readonly banner?: React.ReactNode;
  /** Rendered below the surface (the composer's submit/cancel row). */
  readonly footer?: React.ReactNode;

  /** Padding class for the raw surface (framed vs. flush) — caller styling. */
  readonly rawSurfaceClassName?: string;
}

/**
 * The shared editing chrome. Presentational + routing only: it holds no
 * buffer and no autosave/submit logic — see the file header.
 */
export function MarkdownField({
  mode,
  onModeChange,
  forcedRaw = false,
  text,
  onRichDoc,
  onRawChange,
  mentionCandidates,
  richEditorTestId,
  modeTestIdPrefix = "mode",
  ariaLabel,
  placeholder,
  richEditorKey,
  onRichBlur,
  focusCoords,
  onEditorReady,
  onAttachFiles,
  attachPending = false,
  attachAccept,
  attachInputTestId = "attach-input",
  toolbarTrailing,
  banner,
  footer,
  rawSurfaceClassName = "px-3 py-2",
}: MarkdownFieldProps): React.JSX.Element {
  /**
   * A hidden file input the Attach button clicks. One picker for both
   * surfaces — the chosen files go to `onAttachFiles`, which is the
   * caller's business (the shell does not know or care that they become
   * ticket attachments). Cleared after each pick so the same file can be
   * chosen twice in a row (the same trick `AttachmentsPanel` uses).
   */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * The live TipTap editor, surfaced by `RichEditor` so the shared
   * always-visible toolbar can drive it. Null in raw mode and before the
   * rich editor mounts. Held here (rather than in each caller) so both
   * editors get the toolbar wired the same way. The caller's own
   * `onEditorReady` is chained through, for callers that also need the
   * instance.
   */
  const [richEditor, setRichEditor] = useState<Editor | null>(null);
  const handleEditorReady = useCallback((ed: Editor | null): void => {
    setRichEditor(ed);
    onEditorReady?.(ed);
  }, [onEditorReady]);
  const editorForToolbar = mode === "rich" ? richEditor : null;

  return (
    <div>
      {/* One always-visible toolbar (K33): formatting on the left in rich
          mode (the buttons are absent in raw, where `editor` is null),
          Attach + the compact mode toggle at the right. The trailing slot
          (the SaveIndicator) sits beside it, its height reserved so
          entering edit does not shift the text down. */}
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1">
          <Toolbar
            editor={editorForToolbar}
            mode={mode}
            onModeChange={onModeChange}
            forcedRaw={forcedRaw}
            modeTestIdPrefix={modeTestIdPrefix}
            {...(onAttachFiles !== undefined
              ? { onAttach: () => { fileInputRef.current?.click(); }, attachPending }
              : {})}
          />
        </div>
        {toolbarTrailing !== undefined && (
          <div className="flex shrink-0 items-center border-b border-border-subtle px-2">
            {toolbarTrailing}
          </div>
        )}
      </div>

      {banner}

      {mode === "rich" ? (
        <RichEditor
          // `key` passed directly (never via spread — React 19 warns), so a
          // caller's remount key (a task ref, a reset+embed token) rebuilds
          // the surface. `undefined` is a no-op key.
          key={richEditorKey}
          markdown={text}
          onDocChange={onRichDoc}
          onBlur={onRichBlur ?? (() => {})}
          mentionCandidates={mentionCandidates}
          {...(ariaLabel !== undefined ? { ariaLabel } : {})}
          {...(richEditorTestId !== undefined ? { testId: richEditorTestId } : {})}
          {...(placeholder !== undefined ? { placeholder } : {})}
          // The shell owns the single always-visible toolbar (with the mode
          // toggle), so RichEditor renders none of its own — both editors
          // now get the SAME always-on toolbar instead of the composer's
          // old focus-gated one.
          hideToolbar
          onEditorReady={handleEditorReady}
          {...(focusCoords !== undefined ? { focusCoords } : {})}
        />
      ) : (
        <MarkdownEditor
          value={text}
          onChange={onRawChange}
          ariaLabel={ariaLabel === undefined ? "Markdown source" : `${ariaLabel} (markdown source)`}
          {...(placeholder !== undefined ? { placeholder } : {})}
          className={rawSurfaceClassName}
        />
      )}

      {onAttachFiles !== undefined && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          data-testid={attachInputTestId}
          className="hidden"
          {...(attachAccept !== undefined ? { accept: attachAccept } : {})}
          onChange={e => {
            const files = e.target.files;
            if (files !== null && files.length > 0) onAttachFiles([...files]);
            // Let the same file be chosen again immediately.
            e.target.value = "";
          }}
        />
      )}

      {footer}
    </div>
  );
}
