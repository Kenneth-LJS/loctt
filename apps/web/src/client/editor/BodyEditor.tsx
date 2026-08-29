/**
 * The task-detail body editor (M2.3).
 *
 * Composes the four pieces: the rich surface, the raw CodeMirror
 * surface that already existed, the autosave hook, and the conflict
 * surface. The mode toggle is here because the *buffer* is here —
 * both surfaces read and write one `RichBuffer`, which is what makes
 * TSK-17's round trip a non-operation rather than a re-serialization.
 */

import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BodyConflictDialog } from "./BodyConflictDialog.tsx";
import { RichBuffer } from "./markdown.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { RichEditor } from "./RichEditor.tsx";
import { SaveIndicator } from "./SaveIndicator.tsx";
import { useBodyAutosave } from "./useBodyAutosave.ts";

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

  const { edit, flush } = autosave;

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

  /** Ctrl/Cmd+S forces an immediate save. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [flush]);

  const lossyNote = useMemo(
    () => lossyConstructs.map(c => `${c.kind} (line ${c.line})`).join(", "),
    [lossyConstructs],
  );

  return (
    <div data-testid="body-editor">
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
        <div onBlur={() => { void flush(); }}>
          <MarkdownEditor
            value={text}
            onChange={onRawChange}
            ariaLabel="Description (markdown source)"
            placeholder="Describe this task…"
            className="rounded border border-border-subtle px-3 py-2"
          />
        </div>
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
