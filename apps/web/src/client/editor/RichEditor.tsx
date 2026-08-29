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

import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import { LOCTT_EXTENSIONS } from "./extensions.ts";
import { fromMarkdown } from "./markdown.ts";
import type { MentionCandidate } from "./MentionMenu.tsx";
import { MentionMenu, useMentionState } from "./MentionMenu.tsx";
import { Toolbar } from "./Toolbar.tsx";

export interface RichEditorProps {
  /** Markdown to render. Read once per mount; see `RichBuffer`. */
  readonly markdown: string;
  /** Fires only for real document changes, never selection moves. */
  readonly onDocChange: (doc: import("@tiptap/core").JSONContent) => void;
  readonly onBlur: () => void;
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly ariaLabel?: string;
}

export function RichEditor({
  markdown,
  onDocChange,
  onBlur,
  mentionCandidates,
  ariaLabel = "Description",
}: RichEditorProps): React.JSX.Element {
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const initial = useRef(markdown);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
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
        "data-testid": "rich-editor",
        class: "prose-body min-h-[8rem] outline-none",
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

  return (
    <div className="rounded border border-border-subtle">
      <Toolbar editor={editor} />
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      <MentionMenu state={mention} />
    </div>
  );
}
