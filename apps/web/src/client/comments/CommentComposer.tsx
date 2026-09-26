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
import type { EditorMode } from "../editor/MarkdownField.tsx";
import { MarkdownField } from "../editor/MarkdownField.tsx";
import type { MentionCandidate } from "../editor/MentionMenu.tsx";
import { Button } from "../ui/Button.tsx";
import { SrOnly } from "../ui/Tooltip.tsx";

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
  readonly initialMode?: EditorMode;
  /**
   * Embedded attachments (GOAL 2). When present, the toolbar shows an
   * Attach button; the chosen files are handed here. The composer does
   * not upload — its owner (`CommentsPanel`) uploads to the ticket's
   * attachment store and, on success, inserts the embed into the body via
   * `insertEmbed` below. Absent → no Attach button (an edit composer with
   * no upload wiring simply does not offer it).
   */
  readonly onAttachFiles?: (files: readonly File[]) => void;
  readonly attachPending?: boolean;
  /**
   * Called once by the composer on mount with an `insert` function the
   * owner can use to splice an attachment embed into the current buffer
   * after a successful upload. This is how an uploaded file lands in the
   * comment body without the owner reaching into the editor's internals.
   */
  readonly onEmbedReady?: (insert: (markdown: string) => void) => void;
}

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
  onAttachFiles,
  attachPending = false,
  onEmbedReady,
}: CommentComposerProps): React.JSX.Element {
  const [mode, setMode] = useState<EditorMode>(initialMode);
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
      ?.querySelector<HTMLElement>(`[data-testid='${testId}-rich-editor']`)
      ?.focus();
    // `testId` is a constant string at every call site; it is listed so
    // the selector cannot go stale, not because it is expected to change.
  }, [resetToken, testId]);

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
   * Splices an attachment embed into the composer's buffer after a
   * successful upload (GOAL 2). The embed is its own block, so it is
   * appended after the current text with a blank line between — the same
   * shape a user pasting the reference would get. `reset` makes the new
   * bytes the baseline (like a raw edit), and bumping `embedNonce`
   * remounts the rich surface so it reflects the added embed. Exposed to
   * the owner via `onEmbedReady` so the upload flow (which lives in the
   * panel, next to the attachment store) can call it without reaching
   * into the editor.
   */
  const [embedNonce, setEmbedNonce] = useState(0);
  const insertEmbed = useCallback((embedMarkdown: string) => {
    const current = bufferRef.current.text;
    const joined = current.trim() === ""
      ? embedMarkdown
      : `${current.replace(/\n+$/, "")}\n\n${embedMarkdown}`;
    bufferRef.current.reset(joined);
    setText(joined);
    setEmbedNonce(n => n + 1);
  }, []);

  // Publish the inserter once (and on identity change) so the owner can
  // call it after an upload settles.
  const onEmbedReadyRef = useRef(onEmbedReady);
  onEmbedReadyRef.current = onEmbedReady;
  useEffect(() => {
    onEmbedReadyRef.current?.(insertEmbed);
  }, [insertEmbed]);

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
      {/* The SAME editing chrome the description body uses (MarkdownField):
          the always-visible icon toolbar with its mobile "More" overflow,
          the `</>`-style icon mode toggle with tooltips, and the
          rich/source surfaces. The composer differs only in what it
          brackets this with — the submit/cancel footer below, its
          submit-on-click buffer handling, and (when wired) an Attach
          button — all passed as props, not forked. */}
      <div className="rounded border border-border-subtle">
        <MarkdownField
          mode={mode}
          onModeChange={setMode}
          text={text}
          onRichDoc={onDocChange}
          onRawChange={onRawChange}
          mentionCandidates={mentionCandidates}
          // Remounts on reset, and only then — a key tied to the text would
          // rebuild the editor mid-word and cost the user their caret. The
          // embed nonce bumps it deliberately when a file is spliced in.
          richEditorKey={`${testId}-${String(resetToken)}-${String(embedNonce)}`}
          // Distinct from the description body's `rich-editor` (TSK-67):
          // the two editors coexist on the task-detail page.
          richEditorTestId={`${testId}-rich-editor`}
          // Scope the mode toggle's testids to this composer for the same
          // reason — the description body's are the bare `mode-rich`/`-raw`.
          modeTestIdPrefix={`${testId}-mode`}
          ariaLabel={ariaLabel}
          placeholder="Write a comment…"
          rawSurfaceClassName="px-3 py-2"
          {...(onAttachFiles !== undefined
            ? {
                onAttachFiles,
                attachPending,
                attachInputTestId: `${testId}-attach-input`,
              }
            : {})}
        />
      </div>

      {error !== undefined && (
        <p role="alert" data-testid={`${testId}-error`} className="text-[0.8571rem] text-danger-fg">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          testId={`${testId}-submit`}
          disabled={disabled}
          loading={pending}
          aria-label={submitLabel}
          {...(reason !== undefined ? { title: reason, "aria-describedby": reasonId } : {})}
          /**
           * Trimmed. `toMarkdown` ends every document with a newline —
           * correct for a task body, which is a document, and noise on
           * a one-line comment, which is a remark. What is stored
           * should be what the user wrote, and they did not type a
           * blank line at the end.
           */
          onClick={() => { onSubmit(text.trim()); }}
        >
          {submitLabel}
        </Button>
        {onCancel !== undefined && (
          <Button
            type="button"
            variant="secondary"
            testId={`${testId}-cancel`}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        {/* A description, not a notice (Ken: "i dont need the notice").
            The disabled button already says it cannot be used; the reason
            is for a screen reader and a hover, which is all CMT-2's
            "reason available" asks — the same `SrOnly` pattern A298 gave
            every other disabled reason in the app. */}
        {reason !== undefined && <SrOnly id={reasonId}>{reason}</SrOnly>}
      </div>
    </div>
  );
}
