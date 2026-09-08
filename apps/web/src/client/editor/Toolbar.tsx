/**
 * The formatting toolbar (TSK-18, extended by B3 / K-7).
 *
 * Each button toggles a mark or node on the current selection and
 * reflects whether the caret is already inside that formatting —
 * TSK-18's second bullet. `isActive` is read on every render rather
 * than cached, because the caret moves without the document changing
 * and a cached flag would show the previous position's state.
 *
 * B3 adds the pieces K-7/K-7b asked for:
 *  - a level picker for Paragraph + H1–H6, not just the one H2 button
 *    the original toolbar exposed (TSK-59);
 *  - an ordered-list button beside the bulleted one (TSK-61);
 *  - strikethrough / superscript / subscript mark buttons (TSK-65);
 *  - the caret-stays-in-block guarantee for block transforms (TSK-60).
 *
 * The buttons adopt the B1 `ToolbarButton` primitive so the editor
 * toolbar hovers/focuses like every other toolbar in the app.
 */

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

import { Select } from "../ui/Select.tsx";
import { ToolbarButton } from "../ui/ToolbarButton.tsx";

interface ButtonSpec {
  readonly id: string;
  readonly label: string;
  /** What `isActive` is asked about. */
  readonly active: string;
  readonly activeAttrs?: Record<string, unknown>;
  readonly run: (editor: Editor) => void;
}

/**
 * The mark and list buttons.
 *
 * `superscript`/`subscript` are toggled through the generic
 * `toggleMark` command rather than a dedicated `toggleSuperscript`: the
 * marks in `extensions.ts` are plain `Mark.create` definitions with no
 * command of their own, and adding one there would be schema work in a
 * file this lane does not own. `toggleMark("superscript")` reaches the
 * same mark and round-trips through `markdown.ts` identically.
 *
 * Heading is NOT here — it moved to the level picker (TSK-59). A single
 * H2 button could only ever reach one level, which is the defect K-7
 * reported.
 */
const BUTTONS: readonly ButtonSpec[] = [
  { id: "bold", label: "Bold", active: "bold", run: e => e.chain().focus().toggleBold().run() },
  { id: "italic", label: "Italic", active: "italic", run: e => e.chain().focus().toggleItalic().run() },
  { id: "strike", label: "Strikethrough", active: "strike", run: e => e.chain().focus().toggleStrike().run() },
  {
    id: "superscript", label: "Superscript", active: "superscript",
    run: e => e.chain().focus().toggleMark("superscript").run(),
  },
  {
    id: "subscript", label: "Subscript", active: "subscript",
    run: e => e.chain().focus().toggleMark("subscript").run(),
  },
  { id: "code", label: "Code", active: "code", run: e => e.chain().focus().toggleCode().run() },
  {
    id: "codeBlock", label: "Code block", active: "codeBlock",
    run: e => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "bulletList", label: "Bulleted list", active: "bulletList",
    run: e => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList", label: "Numbered list", active: "orderedList",
    run: e => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "blockquote", label: "Quote", active: "blockquote",
    run: e => e.chain().focus().toggleBlockquote().run(),
  },
];

/** The values the level picker offers, in the order they appear. */
const LEVELS = [1, 2, 3, 4, 5, 6] as const;
type HeadingLevel = (typeof LEVELS)[number];

export function Toolbar({ editor }: { readonly editor: Editor | null }): React.JSX.Element | null {
  /**
   * Subscribes to selection *and* document changes. Without this the
   * active states would only repaint when React re-rendered for some
   * other reason, so moving the caret out of a bold run would leave
   * the Bold button lit — the exact thing TSK-18's second bullet
   * checks. The current block's heading level is read here too, so the
   * picker (TSK-59) reflects where the caret is.
   */
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { active: {} as Record<string, boolean>, level: "paragraph" };
      const active: Record<string, boolean> = {};
      for (const b of BUTTONS) {
        active[b.id] = b.activeAttrs ? ed.isActive(b.active, b.activeAttrs) : ed.isActive(b.active);
      }
      active["link"] = ed.isActive("link");
      const level = LEVELS.find(l => ed.isActive("heading", { level: l }));
      return { active, level: level === undefined ? "paragraph" : String(level) };
    },
  });

  if (!editor) return null;

  const active = state?.active ?? {};

  /**
   * Applies a block type to the whole current block (TSK-59/TSK-60).
   *
   * `.focus()` is what keeps the caret inside the transformed block:
   * without it the command runs but focus is not returned, so the
   * picker would reflect the *old* block on the next selection read and
   * a second apply would run against stale state. Selecting Paragraph
   * on a paragraph is `setParagraph`; a level is `setHeading`. `set*`
   * (not `toggle*`) so re-picking the same level is idempotent and does
   * not toggle back to a paragraph, which is what accumulated the
   * trailing empty blocks the case warns about.
   */
  const applyBlock = (value: string): void => {
    if (value === "paragraph") {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value) as HeadingLevel;
    editor.chain().focus().setHeading({ level }).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-2 py-1"
    >
      <Select
        size="sm"
        aria-label="Block type"
        data-testid="fmt-block-type"
        value={state?.level ?? "paragraph"}
        onChange={e => { applyBlock(e.target.value); }}
        className="mr-1"
      >
        <option value="paragraph">Paragraph</option>
        {LEVELS.map(l => (
          <option key={l} value={String(l)}>{`Heading ${l}`}</option>
        ))}
      </Select>

      {BUTTONS.map(b => (
        <ToolbarButton
          key={b.id}
          size="sm"
          testId={`fmt-${b.id}`}
          aria-label={b.label}
          aria-pressed={active[b.id] === true}
          active={active[b.id] === true}
          onClick={() => { b.run(editor); }}
        >
          {b.label}
        </ToolbarButton>
      ))}
      <LinkButton editor={editor} active={active["link"] === true} />
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
    <ToolbarButton
      size="sm"
      testId="fmt-link"
      aria-label="Link"
      aria-pressed={active}
      active={active}
      onClick={() => {
        if (active) {
          editor.chain().focus().unsetLink().run();
          return;
        }
        const url = window.prompt("Link URL");
        if (url === null || url.trim() === "") return;
        editor.chain().focus().setLink({ href: url.trim() }).run();
      }}
    >
      Link
    </ToolbarButton>
  );
}
