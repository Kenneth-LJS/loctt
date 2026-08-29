/**
 * The formatting toolbar (TSK-18).
 *
 * Each button toggles a mark or node on the current selection and
 * reflects whether the caret is already inside that formatting —
 * TSK-18's second bullet. `isActive` is read on every render rather
 * than cached, because the caret moves without the document changing
 * and a cached flag would show the previous position's state.
 */

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

interface ToolbarButton {
  readonly id: string;
  readonly label: string;
  /** What `isActive` is asked about. */
  readonly active: string;
  readonly activeAttrs?: Record<string, unknown>;
  readonly run: (editor: Editor) => void;
}

const BUTTONS: readonly ToolbarButton[] = [
  { id: "bold", label: "Bold", active: "bold", run: e => e.chain().focus().toggleBold().run() },
  { id: "italic", label: "Italic", active: "italic", run: e => e.chain().focus().toggleItalic().run() },
  { id: "code", label: "Code", active: "code", run: e => e.chain().focus().toggleCode().run() },
  {
    id: "codeBlock", label: "Code block", active: "codeBlock",
    run: e => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "heading", label: "Heading", active: "heading", activeAttrs: { level: 2 },
    run: e => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "bulletList", label: "Bulleted list", active: "bulletList",
    run: e => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "blockquote", label: "Quote", active: "blockquote",
    run: e => e.chain().focus().toggleBlockquote().run(),
  },
];

export function Toolbar({ editor }: { readonly editor: Editor | null }): React.JSX.Element | null {
  /**
   * Subscribes to selection *and* document changes. Without this the
   * active states would only repaint when React re-rendered for some
   * other reason, so moving the caret out of a bold run would leave
   * the Bold button lit — the exact thing TSK-18's second bullet
   * checks.
   */
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return {} as Record<string, boolean>;
      const out: Record<string, boolean> = {};
      for (const b of BUTTONS) {
        out[b.id] = b.activeAttrs ? ed.isActive(b.active, b.activeAttrs) : ed.isActive(b.active);
      }
      out["link"] = ed.isActive("link");
      return out;
    },
  });

  if (!editor) return null;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap gap-1 border-b border-border-subtle px-2 py-1"
    >
      {BUTTONS.map(b => (
        <button
          key={b.id}
          type="button"
          data-testid={`fmt-${b.id}`}
          aria-label={b.label}
          aria-pressed={active?.[b.id] === true}
          onClick={() => { b.run(editor); }}
          className={
            "rounded px-2 py-1 text-[12px] "
            + (active?.[b.id] === true
              ? "bg-accent-muted text-text-primary"
              : "text-text-secondary hover:bg-bg-muted")
          }
        >
          {b.label}
        </button>
      ))}
      <LinkButton editor={editor} active={active?.["link"] === true} />
    </div>
  );
}

/**
 * TSK-18's third bullet: applying a link **prompts for a URL** rather
 * than inserting an empty anchor.
 *
 * An empty `href` is worse than no link — it renders as a clickable
 * element that goes nowhere, and the user cannot see that it is broken
 * without inspecting it. Cancelling the prompt therefore leaves the
 * document untouched rather than inserting the empty one.
 */
function LinkButton(
  { editor, active }: { readonly editor: Editor; readonly active: boolean },
): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="fmt-link"
      aria-label="Link"
      aria-pressed={active}
      onClick={() => {
        if (active) {
          editor.chain().focus().unsetLink().run();
          return;
        }
        const url = window.prompt("Link URL");
        if (url === null || url.trim() === "") return;
        editor.chain().focus().setLink({ href: url.trim() }).run();
      }}
      className={
        "rounded px-2 py-1 text-[12px] "
        + (active ? "bg-accent-muted text-text-primary" : "text-text-secondary hover:bg-bg-muted")
      }
    >
      Link
    </button>
  );
}
