/**
 * The TipTap visual editing surface.
 *
 * `extensions.ts` had the schema for LocTT's own markdown constructs
 * and nothing rendered it; this is the surface that does. The schema
 * matters more than it looks: TipTap drops any node it does not
 * recognise, so without those registrations a body containing `$x$` or
 * `^sup^` would open here and be *deleted* on the next save, silently
 * and with a "saved" indicator.
 */

import type { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extensions";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown } from "./markdown.ts";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { MentionMenu, useMentionState } from "./MentionMenu.tsx";
import { Toolbar } from "./Toolbar.tsx";

/**
 * Matches the raw CodeMirror editor's empty-state copy (TSK-62), so the
 * two surfaces do not disagree about what an empty body reads as. Both
 * `MarkdownEditor` and `CommentComposer` use this literal string.
 */
export const EMPTY_PLACEHOLDER = "Describe this task…";

export interface RichEditorProps {
  /** Markdown to render. Read once per mount; see `RichBuffer`. */
  readonly markdown: string;
  /** Fires only for real document changes, never selection moves. */
  readonly onDocChange: (doc: import("@tiptap/core").JSONContent) => void;
  readonly onBlur: () => void;
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly ariaLabel?: string;
  /**
   * The `data-testid` on the ProseMirror surface. Declared, not spread:
   * the description body and a comment composer both mount this editor,
   * and giving them the same id made the DOM ambiguous (TSK-67). Callers
   * pass distinct ids; the default preserves the historical `rich-editor`
   * for the description body and anything that has not been migrated yet.
   */
  readonly testId?: string;
  /** Placeholder shown while the document is empty (TSK-62). */
  readonly placeholder?: string;
  /**
   * When true the internal formatting toolbar is not rendered — the
   * caller (the description body's `BodyEditor`) owns a single toolbar
   * that also carries the mode toggle, so RichEditor must not render a
   * second one. The comment composer leaves this off and keeps the
   * focus-gated toolbar (TSK-64).
   */
  readonly hideToolbar?: boolean;
  /**
   * Called once the TipTap editor is created (and again with `null` on
   * unmount), so a caller that owns the toolbar can drive it.
   */
  readonly onEditorReady?: (editor: Editor | null) => void;
  /**
   * The viewport point the user clicked to enter edit (TSK-69). When
   * given, the caret is placed at that coordinate (`posAtCoords`) on
   * mount rather than at position 0.
   */
  readonly focusCoords?: { readonly x: number; readonly y: number };
}

export function RichEditor({
  markdown,
  onDocChange,
  onBlur,
  mentionCandidates,
  ariaLabel = "Description",
  testId = "rich-editor",
  placeholder = EMPTY_PLACEHOLDER,
  hideToolbar = false,
  onEditorReady,
  focusCoords,
}: RichEditorProps): React.JSX.Element {
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const initial = useRef(markdown);

  /**
   * The toolbar is collapsed until the surface is focused (TSK-64 /
   * UX-9). A body merely being viewed shows no formatting affordances;
   * they appear the moment the user is editing. Tracked in React state
   * (rather than read from `editor.isFocused` at render) so a focus
   * change repaints the toolbar — TipTap does not re-render React on
   * focus by itself.
   */
  const [focused, setFocused] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder }),
      /**
       * `autolink` off, deliberately. With it on, typing a character
       * directly after existing text lets TipTap decide the run is a
       * URL and wrap it in a link — measured: continuing a body that
       * ended "Original." produced `[Original.My](http://Original.My)`
       * in the stored markdown. The user typed a sentence and got a
       * hyperlink they never asked for, written to their file.
       *
       * `openOnClick` off because a click inside an editor is an edit
       * gesture: navigating away from a half-written body would lose
       * whatever had not yet autosaved.
       */
      Link.configure({ openOnClick: false, autolink: false }),
      ...LOCTT_EXTENSIONS,
    ],
    content: fromMarkdown(initial.current),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "data-testid": testId,
        class: "prose-body min-h-[8rem] outline-none",
      },
      /**
       * Pasting markdown parses it (TSK-63). Without this, the browser
       * hands ProseMirror plain text and each line becomes a literal
       * paragraph, so `# Heading` pastes as the visible characters "#
       * Heading" rather than a heading. We reuse `fromMarkdown` — the
       * same parser the initial load uses — so a paste and a load of the
       * same text produce the same document.
       *
       * Only plain-text pastes are intercepted. An HTML paste (from
       * another rich editor) already carries structure ProseMirror can
       * map through the schema, and re-parsing its text form would throw
       * that structure away. A paste that is a single line with no
       * markdown syntax round-trips through `fromMarkdown` as one
       * paragraph, so ordinary text pastes are unaffected.
       */
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData;
        if (clipboard === null) return false;
        // Inside a code block, paste is verbatim: a shell/YAML snippet whose
        // lines start with `#`, `-`, `>` or `1.` must stay literal text in
        // the fence, not be parsed into blocks that eject out of it. Defer
        // to the default handler, which inserts plain text as-is.
        if (view.state.selection.$from.parent.type.spec.code === true) return false;
        // Defer to the default handler when HTML is present — it carries
        // structure we would lose by dropping to the text form.
        if (clipboard.getData("text/html") !== "") return false;
        const text = clipboard.getData("text/plain");
        if (text === "") return false;
        if (!looksLikeMarkdown(text)) return false;

        insertMarkdownAsSlice(view, text);
        event.preventDefault();
        return true;
      },
    },
    /**
     * `onUpdate` fires for selection changes too. Gating on
     * `transaction.docChanged` is what keeps merely clicking into the
     * rich tab from marking the buffer dirty — and a dirty buffer is
     * what triggers serialization, which is what normalizes the user's
     * markdown. TSK-17's byte-identical requirement fails the moment
     * this gate is removed.
     */
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return;
      onDocChangeRef.current(ed.getJSON());
    },
    onBlur: () => { onBlurRef.current(); },
  });

  const mention = useMentionState(editor, mentionCandidates);

  // Destroy on unmount — TipTap does not do this itself, and a leaked
  // view keeps handling keys on a page that has moved on.
  useEffect(() => () => { editor?.destroy(); }, [editor]);

  // Publish the editor instance so a caller that owns the toolbar (the
  // description body) can drive it, and retract it on teardown.
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  useEffect(() => {
    onEditorReadyRef.current?.(editor);
    return () => { onEditorReadyRef.current?.(null); };
  }, [editor]);

  /**
   * TSK-69: land the caret where the user clicked to enter edit, not at
   * position 0. `posAtCoords` maps the viewport point to a document
   * position; if it misses (a click in the padding), fall back to the
   * document end so the caret is at least somewhere sensible. Run once
   * per editor, guarded on `focusCoords` being supplied — the raw-mode
   * path and the comment composer pass none and are unaffected.
   */
  const focusCoordsRef = useRef(focusCoords);
  focusCoordsRef.current = focusCoords;
  const didFocusAtCoords = useRef(false);
  useEffect(() => {
    if (editor === null || didFocusAtCoords.current) return;
    const coords = focusCoordsRef.current;
    if (coords === undefined) return;
    didFocusAtCoords.current = true;
    try {
      const at = editor.view.posAtCoords({ left: coords.x, top: coords.y });
      if (at !== null) {
        editor.chain().focus(at.pos).run();
        return;
      }
    } catch {
      // jsdom lacks the geometry `posAtCoords` needs; fall through to a
      // plain focus so tests and the no-layout path still land in edit.
    }
    editor.commands.focus("end");
  }, [editor]);

  /**
   * Focus is tracked at the *container* (TSK-64), not on the ProseMirror
   * surface alone. Clicking a toolbar button moves focus off the
   * contenteditable and onto the button — still inside this wrapper — so
   * a surface-only focus flag would collapse the toolbar the instant the
   * user reached for it, unmounting the very button they clicked before
   * the click resolved. `focusin`/`focusout` bubble, and `focusout`
   * carries the element focus is moving *to* as `relatedTarget`; the
   * toolbar stays mounted as long as that target is within the wrapper.
   */
  const onFocusOut = (e: React.FocusEvent<HTMLDivElement>): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocused(false);
  };

  return (
    <div
      // The comment composer frames itself (border + rounding); the
      // description body's `BodyEditor` supplies the frame around the
      // shared toolbar + surface, so RichEditor drops its own there
      // (`hideToolbar`) to avoid a doubled border.
      className={hideToolbar ? "" : "rounded border border-border-subtle"}
      onFocus={() => { setFocused(true); }}
      onBlur={onFocusOut}
    >
      {/*
        The toolbar renders only while the field (surface or its own
        controls) holds focus (TSK-64) — the comment-composer behaviour.
        Kept mounted-then-hidden it would still expose its buttons to a
        `getByRole("toolbar")` query and to the tab order while merely
        viewing, so it is unmounted, not `hidden`.

        `hideToolbar` (the description body) opts out entirely: `BodyEditor`
        renders one always-visible toolbar that also carries the mode
        toggle, so this component must not render a second one.
      */}
      {!hideToolbar && focused ? <Toolbar editor={editor} /> : null}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      <MentionMenu state={mention} />
    </div>
  );
}

/**
 * Parses `text` as markdown and replaces the view's current selection
 * with the parsed blocks (TSK-63).
 *
 * Exported so the paste behaviour is testable without a synthetic
 * ClipboardEvent (jsdom has neither `DataTransfer` nor a reliable paste
 * path): the handler above and the unit test call this same function, so
 * a test that goes green here is exercising the real insert, not a copy
 * of it. The blocks go in as a fully-open `Slice` — inserting the parsed
 * *doc* node would nest a doc inside a doc, which the schema rejects,
 * while a full-open slice lets the pasted blocks merge into the current
 * block the way a normal paste does.
 */
export function insertMarkdownAsSlice(
  view: import("@tiptap/pm/view").EditorView,
  text: string,
): void {
  const docNode = view.state.schema.nodeFromJSON(fromMarkdown(text));
  const slice = new Slice(docNode.content, 0, 0);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

/**
 * A cheap heuristic for "this pasted text is markdown, not prose".
 *
 * The paste handler only diverts from the default when the text carries
 * a block-level markdown construct — a heading, a list marker, a fence,
 * a blockquote, or a table pipe row. Plain prose (even multi-line) falls
 * through to the default paste, so pasting a paragraph does not surprise
 * the user by re-flowing it. False negatives are safe (the default
 * handler still inserts the text); the cost of a false positive is
 * re-parsing prose that happened to look structured, which the block
 * checks below are conservative enough to avoid.
 *
 * Exported for the same reason `insertMarkdownAsSlice` is: the guard is
 * part of the pasted-markdown behaviour and is asserted directly.
 *
 * Heading, fence and pipe-table markers are unambiguous — one line is
 * enough. List and blockquote markers are ambiguous WITHIN prose: a
 * `Seed: v1\n+ 40 cases` or `Price up 5%.\n> 3 people` paste has one
 * marker line among several non-marker lines and is almost certainly not a
 * list. So for a MULTI-line paste a list/quote must have two or more
 * marker lines to divert; a SINGLE-line paste (`- a list`, `1. numbered`)
 * still counts, because a lone pasted line that is a bullet is a bullet.
 * A false negative is safe — the default handler inserts the text.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split("\n");
  const strong = lines.some(line =>
    /^\s{0,3}#{1,6}\s/.test(line) // heading
    || /^\s*(`{3,}|~{3,})/.test(line) // fence
    || /^\s*\|.*\|.*\|/.test(line), // pipe-table row (≥2 pipes)
  );
  if (strong) return true;
  const isList = (line: string): boolean => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  const isQuote = (line: string): boolean => /^\s*>/.test(line);
  const listLines = lines.filter(isList).length;
  const quoteLines = lines.filter(isQuote).length;
  // A single-line paste that is itself a marker counts; within a
  // multi-line paste, require the marker to repeat.
  if (lines.length === 1) return isList(lines[0] ?? "") || isQuote(lines[0] ?? "");
  return listLines >= 2 || quoteLines >= 2;
}
