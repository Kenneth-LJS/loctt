/**
 * The comment composer, and the same surface reused for an in-place
 * edit (CMT-2, CMT-5, CMT-7).
 *
 * ## It is `RichEditor`, not a second editor
 *
 * M2.3 shipped `RichEditor`, `markdown.ts` and `MentionMenu`. A
 * composer with its own textarea and its own `@` handling would be a
 * second mention implementation to keep in step with core's
 * `extractMentions` — and the two drifting is precisely how a picker
 * ends up inserting a token nothing downstream reads. So the composer
 * is `RichEditor` with a `RichBuffer` behind it, exactly as
 * `BodyEditor` is.
 *
 * ## The buffer, and why CMT-3's second bullet needs one
 *
 * `RichBuffer` hands back the *loaded bytes* until the visual editor
 * actually edits. For an edit that is CMT-3's second bullet directly:
 * "reopening the comment for edit shows the source the user typed, not
 * the rendered HTML". Opening an edit and pressing Save with no
 * changes must write back what was stored, byte for byte — which is
 * the absence of a serialization, not a careful one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { RichBuffer } from "../editor/markdown.ts";
import { MarkdownEditor } from "../editor/MarkdownEditor.tsx";
import type { MentionCandidate } from "../editor/MentionMenu.tsx";
import { RichEditor } from "../editor/RichEditor.tsx";

export interface CommentComposerProps {
  /** Markdown to open with. `""` for a fresh composer. */
  readonly initial: string;
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly submitLabel: string;
  readonly ariaLabel: string;
  readonly pending: boolean;
  /** Rendered in place; the typed text is never discarded on failure. */
  readonly error: string | undefined;
  readonly onSubmit: (body: string) => void;
  /** Present for an edit, absent for the composer. `Esc` fires it. */
  readonly onCancel?: (() => void) | undefined;
  readonly testId: string;
  /**
   * Bumped by the caller after a successful post, to clear the surface.
   *
   * A prop rather than an imperative handle because clearing means
   * *rebuilding the editor with an empty document* — TipTap holds its
   * own document, and `RichBuffer` holds the markdown; resetting one
   * without the other leaves the composer showing text it will not
   * submit. Remounting both together is the only state that cannot
   * disagree with itself.
   */
  readonly resetToken?: number;
  /**
   * Which surface opens first.
   *
   * **`"raw"` for an edit**, and CMT-3's second bullet is the reason:
   * "reopening the comment for edit shows the source the user typed,
   * not the rendered HTML". A rich surface shows rendered bold; the
   * markdown surface shows `**bold**`, which is what the user typed
   * and what is stored.
   *
   * **`"rich"` for the composer**, because CMT-7's picker lives there
   * — the `@` autocomplete is a ProseMirror affordance and the raw
   * textarea has none. Writing a new comment is where a picker earns
   * its place; revisiting an old one is where seeing the source does.
   *
   * Both surfaces are reachable from either start: the toggle is the
   * same one `BodyEditor` ships, over the same `RichBuffer`, so
   * flipping to rich in an edit gets the picker back.
   */
  readonly initialMode?: Mode;
}

type Mode = "rich" | "raw";

export function CommentComposer({
  initial,
  mentionCandidates,
  submitLabel,
  ariaLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  testId,
  resetToken = 0,
  initialMode = "rich",
}: CommentComposerProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode);
  const bufferRef = useRef<RichBuffer>(new RichBuffer(initial));
  const [text, setText] = useState(initial);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * A reset is a fresh buffer *and* a fresh editor — see `resetToken`.
   *
   * **Applied during render, not in an effect.** The editor is
   * remounted by a `key` derived from `resetToken`, and that remount
   * happens in the very render the token changes in — while an effect
   * runs *after* it. So an effect-based reset handed the new editor
   * the *previous* buffer's text, and the second comment posted as
   * "second thoughtfirst thought". Measured, not theorised.
   *
   * This is React's documented "adjust state during render" pattern:
   * comparing against the previous token in a ref and setting state
   * inline, which React re-runs the component for before touching the
   * DOM. The new text is therefore what the remounted editor is
   * seeded with.
   */
  const lastReset = useRef(resetToken);
  const lastInitial = useRef(initial);
  if (lastReset.current !== resetToken || lastInitial.current !== initial) {
    lastReset.current = resetToken;
    lastInitial.current = initial;
    bufferRef.current = new RichBuffer(initial);
    setText(initial);
  }

  /**
   * CMT-2: "the composer clears and stays focused so a second comment
   * can be typed without re-clicking."
   *
   * The clear is a remount (see `resetToken`), and a remount destroys
   * the focused element — so focus has to be put back deliberately.
   * Skipped on the first mount: a page that steals focus into a
   * comment box on load moves the user somewhere they did not ask to
   * be, and CMT-2 asks for this only *after* a post.
   */
  const firstMount = useRef(true);
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    containerRef.current
      ?.querySelector<HTMLElement>("[data-testid='rich-editor']")
      ?.focus();
  }, [resetToken]);

  const onDocChange = useCallback((doc: import("@tiptap/core").JSONContent) => {
    bufferRef.current.applyRich(doc);
    setText(bufferRef.current.text);
  }, []);

  /**
   * A raw edit makes the typed bytes the new baseline — the same rule
   * `BodyEditor` applies, and for the same reason: `reset` clears the
   * dirty flag, so what is submitted is what was typed rather than a
   * serialization of it.
   */
  const onRawChange = useCallback((next: string) => {
    bufferRef.current.reset(next);
    setText(next);
  }, []);

  /**
   * CMT-2's last bullet. Whitespace only is not a comment — and the
   * server agrees (`postComment` throws on a blank body), so allowing
   * the click would spend a round trip to be told what the client
   * already knows.
   */
  const blank = text.trim().length === 0;
  const disabled = blank || pending;

  /**
   * CMT-2 requires "the reason available" for the disabled control,
   * not merely a greyed button. `title` plus `aria-describedby` puts
   * it within reach of both a pointer and a screen reader without
   * occupying a line of the composer permanently.
   */
  const reasonId = `${testId}-reason`;
  const reason = blank
    ? "A comment needs some text before it can be posted."
    : pending
      ? "Saving…"
      : undefined;

  // `Esc` cancels an edit (CMT-5's last bullet). Scoped to this
  // composer's subtree rather than the document: a global handler
  // would also fire while the mention menu is open, which has its own
  // Escape meaning (CMT-7 — close the picker without inserting).
  useEffect(() => {
    if (onCancel === undefined) return undefined;
    const node = containerRef.current;
    if (node === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // The picker consumes Escape in the capture phase and does not
      // re-dispatch, so anything reaching here is Escape with no menu
      // open. Guarding on the menu's presence as well keeps that true
      // if the picker's handling ever changes.
      if (document.querySelector("[data-testid='mention-menu']") !== null) return;
      e.stopPropagation();
      onCancel();
    };
    node.addEventListener("keydown", onKey);
    return () => { node.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  return (
    <div ref={containerRef} data-testid={testId} className="space-y-2">
      <div role="group" aria-label="Editing mode" className="flex gap-1">
        <button
          type="button"
          data-testid={`${testId}-mode-rich`}
          aria-pressed={mode === "rich"}
          onClick={() => { setMode("rich"); }}
          className={modeClass(mode === "rich")}
        >
          Rich
        </button>
        <button
          type="button"
          data-testid={`${testId}-mode-raw`}
          aria-pressed={mode === "raw"}
          onClick={() => { setMode("raw"); }}
          className={modeClass(mode === "raw")}
        >
          Markdown
        </button>
      </div>

      {mode === "rich" ? (
        <RichEditor
          // Remounts on reset, and only then — a key tied to the text
          // would rebuild the editor mid-word and cost the user their
          // caret.
          key={`${testId}-${String(resetToken)}`}
          markdown={text}
          onDocChange={onDocChange}
          onBlur={() => {}}
          mentionCandidates={mentionCandidates}
          ariaLabel={ariaLabel}
        />
      ) : (
        <MarkdownEditor
          value={text}
          onChange={onRawChange}
          ariaLabel={`${ariaLabel} (markdown source)`}
          placeholder="Write a comment…"
          className="rounded border border-border-subtle px-3 py-2"
        />
      )}

      {error !== undefined && (
        <p role="alert" data-testid={`${testId}-error`} className="text-[12px] text-danger-fg">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-submit`}
          disabled={disabled}
          {...(reason !== undefined ? { title: reason, "aria-describedby": reasonId } : {})}
          /**
           * Trimmed. `toMarkdown` ends every document with a newline —
           * correct for a task body, which is a document, and noise on
           * a one-line comment, which is a remark. What is stored
           * should be what the user wrote, and they did not type a
           * blank line at the end.
           */
          onClick={() => { onSubmit(text.trim()); }}
          className={
            "rounded-md px-3 py-1.5 text-[13px] font-medium "
            + (disabled
              ? "cursor-not-allowed bg-bg-muted text-text-tertiary"
              : "bg-accent text-white hover:opacity-90")
          }
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel !== undefined && (
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted"
          >
            Cancel
          </button>
        )}
        {reason !== undefined && (
          <span id={reasonId} data-testid={`${testId}-reason`} className="text-[12px] text-text-tertiary">
            {reason}
          </span>
        )}
      </div>
    </div>
  );
}

function modeClass(active: boolean): string {
  return (
    "rounded px-2 py-1 text-[12px] "
    + (active
      ? "bg-accent-muted text-text-primary"
      : "text-text-secondary hover:bg-bg-muted")
  );
}
