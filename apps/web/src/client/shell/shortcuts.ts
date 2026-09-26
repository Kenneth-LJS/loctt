/**
 * The global keyboard shortcut registry.
 *
 * ## Why a registry rather than more `addEventListener` calls
 *
 * A11Y-4's second bullet is the reason this module exists: "the list
 * matches the shortcuts actually bound — a shortcut that exists but
 * isn't listed, or listed but not bound, is a defect." So the bindings
 * and their descriptions are one table. `useShortcuts` dispatches from
 * it, and the `?` dialog and Settings → Keyboard render from it. A
 * shortcut added to the table is bound *and* documented; one removed is
 * gone from both.
 *
 * The table itself lives in `@loctt/contracts` (K133): core validates
 * the per-user off switches against the same ids, and the CLI and MCP
 * print the same list. This module adds the dispatch rules.
 *
 * ## What stayed where it was
 *
 * Context-scoped keys are **not** here. `Ctrl+←` on a board card,
 * `Esc` inside a modal, `↑`/`↓` on a reorder handle — those are bound
 * by the component that owns the focus, and they are not switched off
 * by K133's switches (they carry a modifier or need their control
 * focused, which WCAG 2.1.4 exempts).
 */
import type { ShortcutCommand, ShortcutId } from "@loctt/contracts";
import { GLOBAL_SHORTCUTS } from "@loctt/contracts";

export type { ShortcutCommand, ShortcutId, ShortcutSpec } from "@loctt/contracts";
export { GLOBAL_SHORTCUTS } from "@loctt/contracts";

/** The chord prefix window. A `g` older than this is forgotten. */
export const CHORD_TIMEOUT_MS = 1_500;

/**
 * Which shortcuts may fire. The default is "all of them", which is what
 * a user who never touched the switches has.
 */
export type ShortcutFilter = (id: ShortcutId) => boolean;
const ALL_ON: ShortcutFilter = () => true;

interface DispatchEntry {
  readonly id: ShortcutId;
  readonly command: ShortcutCommand;
  readonly keys: readonly string[];
}

/** Every key sequence in the table, flattened, with its shortcut. */
const DISPATCH: readonly DispatchEntry[] = GLOBAL_SHORTCUTS.flatMap(s =>
  s.bindings.map(b => ({ id: s.id, command: b.command, keys: b.keys })),
);

/**
 * Whether `key` opens a chord, among the shortcuts currently on.
 *
 * Filtered, not fixed: K133 requires that with every `g` sequence
 * switched off, `g` is an ordinary key again. A prefix that stayed
 * armed would swallow the next keystroke for a shortcut that cannot
 * fire.
 */
export function isChordPrefix(key: string, isOn: ShortcutFilter = ALL_ON): boolean {
  return DISPATCH.some(d => d.keys.length > 1 && d.keys[0] === key && isOn(d.id));
}

/**
 * Resolves a keystroke to a command, given any chord prefix pending and
 * which shortcuts are switched on.
 *
 * Split out as a pure function so the dispatch rules are unit-testable
 * without a DOM: the chord timeout, the "unmapped second key is a
 * no-op, not a stuck state" rule (A11Y-3), the single-key path, and the
 * K133 off switches.
 */
export type Resolution =
  | { readonly kind: "fire"; readonly command: ShortcutCommand }
  | { readonly kind: "chord-start"; readonly prefix: string }
  | { readonly kind: "none" };

export function resolveShortcut(
  key: string,
  pendingPrefix: string | null,
  isOn: ShortcutFilter = ALL_ON,
): Resolution {
  if (pendingPrefix !== null) {
    const chord = DISPATCH.find(
      d => d.keys.length === 2 && d.keys[0] === pendingPrefix && d.keys[1] === key && isOn(d.id),
    );
    // A11Y-3's third bullet: `g` then an unmapped key is a no-op. The
    // caller clears the prefix either way.
    if (chord !== undefined) return { kind: "fire", command: chord.command };
    return { kind: "none" };
  }
  if (isChordPrefix(key, isOn)) return { kind: "chord-start", prefix: key };
  const single = DISPATCH.find(d => d.keys.length === 1 && d.keys[0] === key && isOn(d.id));
  if (single !== undefined) return { kind: "fire", command: single.command };
  return { kind: "none" };
}
