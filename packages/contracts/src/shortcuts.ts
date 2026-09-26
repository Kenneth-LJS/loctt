import { z } from "zod";

/**
 * The global single-key shortcut catalog (A11Y-4, K133).
 *
 * Lives in contracts, not in the web client, because three surfaces
 * need the same list: the web app dispatches from it and renders the
 * `?` dialog and Settings → Keyboard from it, core validates the stored
 * `keyboard_shortcuts.disabled` ids against it, and the CLI and MCP
 * print it. One table means a shortcut added here is bound, documented
 * and switchable everywhere at once.
 *
 * Context-scoped keys (Ctrl+arrows on a board card, Esc in a dialog,
 * Cmd/Ctrl+Enter in the editor, arrows on a reorder handle) are not
 * here. They either carry a modifier or only act while their control
 * has focus, so WCAG 2.1.4 does not ask for them to be switchable, and
 * K133's off switches do not touch them.
 *
 * The keys are fixed (K133: "Off switches only, no rebinding").
 */
export const SHORTCUT_IDS = [
  "new-task",
  "focus-search",
  "goto",
  "toggle-sidebar",
  "cycle-theme",
  "shortcut-help",
] as const;
export type ShortcutId = (typeof SHORTCUT_IDS)[number];

/**
 * What a key sequence does, as the web dispatcher names its handlers.
 * A shortcut with several sequences (Go to) has one command per
 * sequence; the switch is per shortcut, the handler per command.
 */
export type ShortcutCommand =
  | "new-task"
  | "focus-search"
  | "goto-list"
  | "goto-board"
  | "goto-timeline"
  | "toggle-sidebar"
  | "cycle-theme"
  | "shortcut-help";

/** One keystroke sequence and what it does. */
export interface ShortcutBinding {
  readonly command: ShortcutCommand;
  /**
   * Keys as `KeyboardEvent.key`, in order. `["g", "l"]` is `g` then
   * `l`, not `g`+`l` held together.
   */
  readonly keys: readonly string[];
  /** What it does, in the user's words. */
  readonly action: string;
}

export interface ShortcutSpec {
  readonly id: ShortcutId;
  /**
   * What the shortcut does as a whole, in the user's words. The row
   * label in the `?` dialog and the settings editor.
   */
  readonly action: string;
  /** Which group the dialog files it under. */
  readonly group: string;
  /**
   * The key sequences this shortcut answers to. Most have one. The
   * Go-to shortcut has three (`g` then `l`, `b` or `t`): K133 makes a
   * shortcut the unit a user switches off, and the three `g` sequences
   * are one "Go to" shortcut with one switch.
   */
  readonly bindings: readonly ShortcutBinding[];
}

/**
 * Every global shortcut, in the order the `?` dialog lists them.
 *
 * `?` itself is in the table: a help dialog that does not document how
 * it was opened is the one row a user cannot look up.
 */
export const GLOBAL_SHORTCUTS: readonly ShortcutSpec[] = [
  {
    id: "new-task",
    action: "Create a task",
    group: "Actions",
    bindings: [{ command: "new-task", keys: ["n"], action: "Create a task" }],
  },
  {
    id: "focus-search",
    action: "Focus the search box",
    group: "Actions",
    bindings: [{ command: "focus-search", keys: ["/"], action: "Focus the search box" }],
  },
  {
    id: "goto",
    action: "Go to List, Board or Timeline",
    group: "Navigation",
    bindings: [
      { command: "goto-list", keys: ["g", "l"], action: "Go to List" },
      { command: "goto-board", keys: ["g", "b"], action: "Go to Board" },
      { command: "goto-timeline", keys: ["g", "t"], action: "Go to Timeline" },
    ],
  },
  {
    id: "toggle-sidebar",
    action: "Collapse or expand the sidebar",
    group: "Navigation",
    bindings: [{ command: "toggle-sidebar", keys: ["["], action: "Collapse or expand the sidebar" }],
  },
  {
    id: "cycle-theme",
    action: "Cycle the theme",
    group: "View",
    bindings: [{ command: "cycle-theme", keys: ["t"], action: "Cycle the theme" }],
  },
  {
    id: "shortcut-help",
    action: "Show keyboard shortcuts",
    group: "Help",
    bindings: [{ command: "shortcut-help", keys: ["?"], action: "Show keyboard shortcuts" }],
  },
];

/**
 * Per-user shortcut switches (K133), stored as `keyboard_shortcuts` in
 * the user's `settings.yaml`.
 *
 * - `single_key` is the master switch. Absent means on. `false` turns
 *   every shortcut in `GLOBAL_SHORTCUTS` off at once.
 * - `disabled` lists the shortcuts turned off one by one. Absent or
 *   empty means none. The list is kept while the master is off, so
 *   turning the master back on restores the user's per-shortcut
 *   choices rather than wiping them.
 *
 * Ids, not keys: the keys are fixed, and an id survives a relabel.
 *
 * The schema is the *stored* contract and stays strict (duplicates and
 * unknown ids rejected) so a clean save stays clean. Tolerance for a
 * hand-edited file lives in the reader (`core/users/shortcuts.ts`),
 * which drops the bad parts field-locally instead of throwing.
 */
export const KeyboardShortcutsSchema = z
  .object({
    single_key: z.boolean().optional(),
    disabled: z
      .array(z.enum(SHORTCUT_IDS))
      .refine(ids => new Set(ids).size === ids.length, {
        message: "keyboard_shortcuts.disabled must not repeat an id",
      })
      .optional(),
  })
  .strict();
export type KeyboardShortcuts = z.infer<typeof KeyboardShortcutsSchema>;
