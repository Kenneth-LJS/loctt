/**
 * The global keyboard shortcut registry.
 *
 * ## Why a registry rather than more `addEventListener` calls
 *
 * A11Y-4's second bullet is the reason this module exists: "the list
 * matches the shortcuts actually bound — a shortcut that exists but
 * isn't listed, or listed but not bound, is a defect." Before this,
 * `[` lived in `useSidebarCollapse` and `n` in `CreateTaskProvider`,
 * and the `?` reference in `KeyboardPanel` was a hand-maintained array
 * with source line numbers in comments. That arrangement makes the
 * case's bullet unassertable by construction: the only way to check
 * the list against the bindings is for a human to re-read both.
 *
 * So the bindings and their descriptions are one table. `useShortcuts`
 * dispatches from it and the `?` dialog renders from it. A shortcut
 * added to the table is bound *and* documented; one removed is gone
 * from both. The test asserts the dialog's rows against this same
 * export, which is only meaningful because the dispatcher cannot be
 * fed a different list.
 *
 * ## What stayed where it was
 *
 * Context-scoped keys are **not** here. `Ctrl+←` on a board card,
 * `Esc` inside a modal, `↑`/`↓` on a reorder handle — those are bound
 * by the component that owns the focus, they only make sense while it
 * is focused, and hoisting them into a global table would mean the
 * global handler needs to know what has focus. This registry is only
 * the keys that fire with nothing in particular focused.
 */

/** The chord prefix window. A `g` older than this is forgotten. */
export const CHORD_TIMEOUT_MS = 1_500;

export type ShortcutId =
  | "new-task"
  | "focus-search"
  | "goto-list"
  | "goto-board"
  | "goto-timeline"
  | "shortcut-help"
  | "toggle-sidebar"
  | "cycle-theme";

export interface ShortcutSpec {
  readonly id: ShortcutId;
  /**
   * The key as `KeyboardEvent.key`. For a chord, the two keys in
   * order — `["g", "l"]` means `g` then `l`, not `g`+`l`.
   */
  readonly keys: readonly string[];
  /** What it does, in the user's words. Rendered in the `?` dialog. */
  readonly action: string;
  /** Which group the `?` dialog files it under. */
  readonly group: string;
}

/**
 * Every globally-bound key, in the order the `?` dialog lists them.
 *
 * `?` itself is in the table. A help dialog that does not document how
 * it was opened is the one row a user cannot look up.
 */
export const GLOBAL_SHORTCUTS: readonly ShortcutSpec[] = [
  { id: "new-task", keys: ["n"], action: "Create a task", group: "Actions" },
  { id: "focus-search", keys: ["/"], action: "Focus the search box", group: "Actions" },
  { id: "goto-list", keys: ["g", "l"], action: "Go to List", group: "Navigation" },
  { id: "goto-board", keys: ["g", "b"], action: "Go to Board", group: "Navigation" },
  { id: "goto-timeline", keys: ["g", "t"], action: "Go to Timeline", group: "Navigation" },
  { id: "toggle-sidebar", keys: ["["], action: "Collapse or expand the sidebar", group: "Navigation" },
  { id: "cycle-theme", keys: ["t"], action: "Cycle the theme", group: "View" },
  { id: "shortcut-help", keys: ["?"], action: "Show keyboard shortcuts", group: "Help" },
];

/** The chord prefixes in the table — currently just `g`. */
const CHORD_PREFIXES = new Set(
  GLOBAL_SHORTCUTS.filter(s => s.keys.length > 1).map(s => s.keys[0] as string),
);

export function isChordPrefix(key: string): boolean {
  return CHORD_PREFIXES.has(key);
}

/**
 * Resolves a keystroke to a shortcut, given any chord prefix pending.
 *
 * Split out as a pure function so the dispatch rules are unit-testable
 * without a DOM: the chord timeout, the "unmapped second key is a
 * no-op, not a stuck state" rule (A11Y-3), and the single-key path.
 *
 * Returns the matched shortcut, or the reason nothing matched — the
 * caller needs to distinguish "this opened a chord" (swallow the key,
 * arm the prefix) from "nothing here" (let the key through).
 */
export type Resolution =
  | { readonly kind: "fire"; readonly id: ShortcutId }
  | { readonly kind: "chord-start"; readonly prefix: string }
  | { readonly kind: "none" };

export function resolveShortcut(key: string, pendingPrefix: string | null): Resolution {
  if (pendingPrefix !== null) {
    const chord = GLOBAL_SHORTCUTS.find(
      s => s.keys.length === 2 && s.keys[0] === pendingPrefix && s.keys[1] === key,
    );
    // A11Y-3's third bullet: `g` then an unmapped key is a no-op. It
    // clears the prefix either way — returning "none" here with the
    // caller clearing is what stops `g` from arming indefinitely and
    // swallowing whatever the user types next.
    if (chord !== undefined) return { kind: "fire", id: chord.id };
    return { kind: "none" };
  }
  if (isChordPrefix(key)) return { kind: "chord-start", prefix: key };
  const single = GLOBAL_SHORTCUTS.find(s => s.keys.length === 1 && s.keys[0] === key);
  if (single !== undefined) return { kind: "fire", id: single.id };
  return { kind: "none" };
}
