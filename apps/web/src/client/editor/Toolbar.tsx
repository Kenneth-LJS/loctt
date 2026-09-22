/**
 * The formatting toolbar (TSK-18, extended by B3 / K-7, restructured for
 * the Phase-0 editor polish).
 *
 * Each button toggles a mark or node on the current selection and
 * reflects whether the caret is already inside that formatting —
 * TSK-18's second bullet. `isActive` is read on every render rather
 * than cached, because the caret moves without the document changing
 * and a cached flag would show the previous position's state.
 *
 * ## Phase-0 changes
 *
 *  - The text-label pills are now `<Icon>` glyph buttons: each carries an
 *    `aria-label` **and** a `title` naming its keyboard shortcut
 *    ("Bold (⌘B)"), so the affordance is a drawn glyph rather than a word
 *    (A208), and the shortcut is discoverable on hover.
 *  - Undo / redo buttons were added.
 *  - The controls are grouped with separators, and the secondary ones
 *    collapse into a "More" overflow menu below 640px (`sm`) so the bar
 *    does not wrap to three or four rows on a phone.
 *  - The Rich/Markdown mode toggle moved to the RIGHT end of the bar as a
 *    compact `</>` toggle (it used to sit first, in `BodyEditor`).
 *  - The bar is no longer focus-gated for the description body: it is
 *    always shown in edit mode and its height is reserved, so entering
 *    edit does not shift the text down. (The comment composer keeps the
 *    focus-gate; see `RichEditor`.)
 *
 * B3 adds the pieces K-7/K-7b asked for:
 *  - a level picker for Paragraph + H1–H6 (TSK-59);
 *  - an ordered-list button beside the bulleted one (TSK-61);
 *  - strikethrough / superscript / subscript mark buttons (TSK-65);
 *  - the caret-stays-in-block guarantee for block transforms (TSK-60).
 */

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

import { SelectCombobox } from "../ui/Combobox.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { ToolbarButton } from "../ui/ToolbarButton.tsx";

/** The platform modifier symbol used in shortcut hints. */
const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)
  ? "⌘"
  : "Ctrl";

interface ButtonSpec {
  readonly id: string;
  /** The accessible name; the shortcut is appended for the `title`. */
  readonly label: string;
  readonly icon: IconName;
  /** Keyboard shortcut hint, already localised for the platform. */
  readonly shortcut?: string;
  /** What `isActive` is asked about. */
  readonly active: string;
  readonly activeAttrs?: Record<string, unknown>;
  readonly run: (editor: Editor) => void;
}

/**
 * The mark and list buttons, in visual order.
 *
 * `superscript`/`subscript` are toggled through the generic `toggleMark`
 * command rather than a dedicated `toggleSuperscript`: the marks in
 * `extensions.ts` are plain `Mark.create` definitions with no command of
 * their own, and adding one there would be schema work in a file this
 * lane does not own. `toggleMark("superscript")` reaches the same mark
 * and round-trips through `markdown.ts` identically.
 *
 * `primary` buttons stay on the bar at every width; the rest collapse
 * into the "More" overflow menu below `sm`.
 *
 * Heading is NOT here — it lives in the level picker (TSK-59).
 */
interface Group {
  readonly key: string;
  readonly buttons: readonly ButtonSpec[];
}

const GROUPS: readonly Group[] = [
  {
    key: "marks",
    buttons: [
      { id: "bold", label: "Bold", icon: "bold", shortcut: `${MOD}B`, active: "bold", run: e => e.chain().focus().toggleBold().run() },
      { id: "italic", label: "Italic", icon: "italic", shortcut: `${MOD}I`, active: "italic", run: e => e.chain().focus().toggleItalic().run() },
      { id: "strike", label: "Strikethrough", icon: "strikethrough", shortcut: `${MOD}⇧S`, active: "strike", run: e => e.chain().focus().toggleStrike().run() },
    ],
  },
  {
    key: "code",
    buttons: [
      { id: "code", label: "Code", icon: "code", shortcut: `${MOD}E`, active: "code", run: e => e.chain().focus().toggleCode().run() },
      { id: "codeBlock", label: "Code block", icon: "codeBlock", active: "codeBlock", run: e => e.chain().focus().toggleCodeBlock().run() },
    ],
  },
  {
    key: "lists",
    buttons: [
      { id: "bulletList", label: "Bulleted list", icon: "list", active: "bulletList", run: e => e.chain().focus().toggleBulletList().run() },
      { id: "orderedList", label: "Numbered list", icon: "listNumbered", active: "orderedList", run: e => e.chain().focus().toggleOrderedList().run() },
      { id: "blockquote", label: "Quote", icon: "quote", active: "blockquote", run: e => e.chain().focus().toggleBlockquote().run() },
    ],
  },
  {
    key: "script",
    buttons: [
      { id: "superscript", label: "Superscript", icon: "superscript", active: "superscript", run: e => e.chain().focus().toggleMark("superscript").run() },
      { id: "subscript", label: "Subscript", icon: "subscript", active: "subscript", run: e => e.chain().focus().toggleMark("subscript").run() },
    ],
  },
];

/**
 * The IDs that stay on the bar at every width. Everything else moves into
 * the "More" menu below `sm` (640px) so a phone shows one clean row.
 */
const PRIMARY_IDS = new Set(["bold", "italic", "strike", "bulletList", "orderedList", "link"]);

/** All button specs, flattened, for the active-state selector. */
const ALL_BUTTONS: readonly ButtonSpec[] = GROUPS.flatMap(g => g.buttons);

/** The values the level picker offers, in the order they appear. */
const LEVELS = [1, 2, 3, 4, 5, 6] as const;
type HeadingLevel = (typeof LEVELS)[number];

export interface ToolbarProps {
  readonly editor: Editor | null;
  /**
   * The Rich/Markdown mode toggle, rendered at the right end (K33). When
   * omitted (the comment composer), no toggle is shown.
   */
  readonly mode?: "rich" | "raw";
  readonly onModeChange?: (mode: "rich" | "raw") => void;
  /** True when the body must stay in raw mode (lossy constructs, B5). */
  readonly forcedRaw?: boolean;
  /**
   * The `data-testid` stem for the mode toggle's two segments. The
   * description body keeps the historical bare `mode-rich`/`mode-raw`;
   * the comment composer passes its own testId so the two editors on the
   * task-detail page do not collide (the same reason `RichEditor`'s
   * `testId` is per-surface). Defaults to `mode`.
   */
  readonly modeTestIdPrefix?: string;
  /**
   * When present, an Attach button is shown in the toolbar. Clicking it
   * asks the host to add an attachment (a file picker). The button is a
   * plain affordance driven entirely by the callback, so both the
   * description body and the comment composer can share it — the file's
   * destination (the ticket's attachment store) is the host's concern,
   * not the toolbar's.
   */
  readonly onAttach?: () => void;
  /** Disables the Attach button while an upload is in flight. */
  readonly attachPending?: boolean;
}

export function Toolbar({
  editor,
  mode,
  onModeChange,
  forcedRaw = false,
  modeTestIdPrefix = "mode",
  onAttach,
  attachPending = false,
}: ToolbarProps): React.JSX.Element | null {
  /**
   * Subscribes to selection *and* document changes. Without this the
   * active states would only repaint when React re-rendered for some
   * other reason, so moving the caret out of a bold run would leave the
   * Bold button lit — the exact thing TSK-18's second bullet checks. The
   * current block's heading level and undo/redo availability are read
   * here too, so the picker (TSK-59) and the history buttons reflect the
   * live editor state.
   */
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) {
        return {
          active: {} as Record<string, boolean>,
          level: "paragraph",
          canUndo: false,
          canRedo: false,
        };
      }
      const active: Record<string, boolean> = {};
      for (const b of ALL_BUTTONS) {
        active[b.id] = b.activeAttrs ? ed.isActive(b.active, b.activeAttrs) : ed.isActive(b.active);
      }
      active["link"] = ed.isActive("link");
      const level = LEVELS.find(l => ed.isActive("heading", { level: l }));
      return {
        active,
        level: level === undefined ? "paragraph" : String(level),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      };
    },
  });

  const active = state?.active ?? {};

  /**
   * Applies a block type to the whole current block (TSK-59/TSK-60).
   *
   * `.focus()` is what keeps the caret inside the transformed block:
   * without it the command runs but focus is not returned, so the picker
   * would reflect the *old* block on the next selection read. `set*`
   * (not `toggle*`) so re-picking the same level is idempotent.
   */
  const applyBlock = (value: string): void => {
    if (editor === null) return;
    if (value === "paragraph") {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value) as HeadingLevel;
    editor.chain().focus().setHeading({ level }).run();
  };

  const renderButton = (b: ButtonSpec): React.JSX.Element => (
    <ToolbarButton
      key={b.id}
      size="sm"
      testId={`fmt-${b.id}`}
      aria-label={b.label}
      title={b.shortcut !== undefined ? `${b.label} (${b.shortcut})` : b.label}
      aria-pressed={active[b.id] === true}
      active={active[b.id] === true}
      disabled={editor === null}
      onClick={() => { if (editor !== null) b.run(editor); }}
    >
      <Icon name={b.icon} size={16} />
    </ToolbarButton>
  );

  // The primary buttons (minus `link`, which has its own component) stay
  // on the bar at every width, in canonical order. The secondary ones are
  // visible from `sm` up and collapse into the "More" menu below it.
  const primaryButtons = ALL_BUTTONS.filter(b => PRIMARY_IDS.has(b.id));
  const secondaryButtons = ALL_BUTTONS.filter(b => !PRIMARY_IDS.has(b.id));

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      // Height reserved (min-h) so the row does not shift the text down
      // when it renders, and so it lines up with the mode toggle.
      className="flex min-h-[2.25rem] flex-wrap items-center gap-1 border-b border-border-subtle px-2 py-1"
    >
      {/* Formatting controls apply to the rich surface only. In raw
          (source) mode `editor` is null and the bar carries just the
          mode toggle — a disabled formatting row would be clutter that
          does nothing. The comment composer always passes an editor, so
          it always sees the controls. */}
      {editor !== null && (
        <>
          <SelectCombobox
            size="sm"
            aria-label="Block type"
            testId="fmt-block-type"
            value={state?.level ?? "paragraph"}
            onChange={applyBlock}
            className="mr-1"
            options={[
              { value: "paragraph", label: "Paragraph" },
              ...LEVELS.map(l => ({ value: String(l), label: `Heading ${l}` })),
            ]}
          />

          <Separator />

          {/* Primary buttons — always on the bar, at every width. */}
          {primaryButtons.map(renderButton)}

          <LinkButton editor={editor} active={active["link"] === true} />

          {/* Secondary buttons — visible from `sm` up; below it they are
              display:none here (still in the DOM/tab-order-free) and reached
              through the "More" menu, so a phone shows one row not 3–4. */}
          <span className="hidden items-center gap-1 sm:flex">
            <Separator />
            {secondaryButtons.map(renderButton)}
          </span>

          <Separator />
          <ToolbarButton
            size="sm"
            testId="fmt-undo"
            aria-label="Undo"
            title={`Undo (${MOD}Z)`}
            disabled={state?.canUndo !== true}
            onClick={() => { editor.chain().focus().undo().run(); }}
          >
            <Icon name="undo" size={16} />
          </ToolbarButton>
          <ToolbarButton
            size="sm"
            testId="fmt-redo"
            aria-label="Redo"
            title={`Redo (${MOD}⇧Z)`}
            disabled={state?.canRedo !== true}
            onClick={() => { editor.chain().focus().redo().run(); }}
          >
            <Icon name="redo" size={16} />
          </ToolbarButton>

          {/* Overflow — only below `sm`, holding the secondary controls. */}
          <span className="sm:hidden">
            <Menu
              aria-label="More formatting"
              trigger={({ toggle, ...aria }) => (
                <ToolbarButton
                  size="sm"
                  testId="fmt-more"
                  aria-label="More formatting"
                  title="More formatting"
                  onClick={toggle}
                  {...aria}
                >
                  <Icon name="more" size={16} />
                </ToolbarButton>
              )}
            >
              {({ close }) => (
                <>
                  {secondaryButtons.map(b => (
                    <MenuItem
                      key={b.id}
                      testId={`fmt-menu-${b.id}`}
                      onSelect={() => { editor.chain().focus().run(); b.run(editor); close(); }}
                    >
                      <Icon name={b.icon} size={14} />
                      {b.label}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
          </span>
        </>
      )}

      {/* Attach + the Rich/Markdown mode toggle sit at the right end (K33).
          `ml-auto` on this cluster pushes both to the far right whether or
          not the formatting controls above are present (raw mode has none). */}
      {(onAttach !== undefined || (mode !== undefined && onModeChange !== undefined)) && (
        <div className="ml-auto flex items-center gap-1">
          {onAttach !== undefined && (
            <ToolbarButton
              size="sm"
              testId="fmt-attach"
              aria-label="Attach a file"
              title="Attach a file"
              disabled={attachPending}
              onClick={onAttach}
            >
              <Icon name="paperclip" size={16} />
            </ToolbarButton>
          )}
          {mode !== undefined && onModeChange !== undefined && (
            <ModeToggle
              mode={mode}
              onModeChange={onModeChange}
              forcedRaw={forcedRaw}
              testIdPrefix={modeTestIdPrefix}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A thin vertical divider between button groups. */
function Separator(): React.JSX.Element {
  return <span aria-hidden="true" className="mx-0.5 h-5 shrink-0 border-l border-border-subtle" />;
}

/**
 * The compact `</>` Rich/Markdown toggle (K33), a two-state segmented
 * control. `forcedRaw` (a lossy body, B5) locks it to Markdown and
 * disables the Rich half rather than hiding the control, so the state is
 * still legible.
 */
function ModeToggle({
  mode,
  onModeChange,
  forcedRaw,
  testIdPrefix,
}: {
  readonly mode: "rich" | "raw";
  readonly onModeChange: (mode: "rich" | "raw") => void;
  readonly forcedRaw: boolean;
  readonly testIdPrefix: string;
}): React.JSX.Element {
  return (
    <div role="group" aria-label="Editing mode" className="inline-flex items-center rounded-md bg-bg-muted p-0.5">
      <button
        type="button"
        data-testid={`${testIdPrefix}-rich`}
        aria-pressed={mode === "rich"}
        disabled={forcedRaw}
        // Both segments name their surface on hover. Rich text is WYSIWYG,
        // Markdown shows the source — the glyph carries the shortcut of a
        // toggle, the tooltip carries the meaning (Ken: icon + tooltip,
        // not "Rich"/"Markdown" text labels).
        title="Rich text (formatted)"
        onClick={() => { onModeChange("rich"); }}
        className={segClass(mode === "rich", forcedRaw)}
      >
        <Icon name="eye" size={14} />
      </button>
      <button
        type="button"
        data-testid={`${testIdPrefix}-raw`}
        aria-pressed={mode === "raw"}
        title="Markdown source"
        onClick={() => { onModeChange("raw"); }}
        className={segClass(mode === "raw", false)}
      >
        <Icon name="sourceCode" size={14} />
      </button>
    </div>
  );
}

function segClass(activeSeg: boolean, disabled: boolean): string {
  return (
    "inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[0.8571rem] "
    + (disabled
      ? "cursor-not-allowed text-text-tertiary"
      : activeSeg
        ? "bg-bg-surface text-text-primary shadow-raised"
        : "text-text-secondary hover:text-text-primary")
  );
}

/**
 * TSK-18's third bullet: applying a link **prompts for a URL** rather
 * than inserting an empty anchor.
 *
 * An empty `href` is worse than no link — it renders as a clickable
 * element that goes nowhere. Cancelling the prompt leaves the document
 * untouched.
 */
function LinkButton(
  { editor, active }: { readonly editor: Editor | null; readonly active: boolean },
): React.JSX.Element {
  return (
    <ToolbarButton
      size="sm"
      testId="fmt-link"
      aria-label="Link"
      title="Link"
      aria-pressed={active}
      active={active}
      disabled={editor === null}
      onClick={() => {
        if (editor === null) return;
        if (active) {
          editor.chain().focus().unsetLink().run();
          return;
        }
        const url = window.prompt("Link URL");
        if (url === null || url.trim() === "") return;
        editor.chain().focus().setLink({ href: url.trim() }).run();
      }}
    >
      <Icon name="link" size={16} />
    </ToolbarButton>
  );
}
