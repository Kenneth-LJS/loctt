import { describe, expect, it } from "vitest";

import { GLOBAL_SHORTCUTS, isChordPrefix, resolveShortcut } from "./shortcuts.ts";

/**
 * The shortcut registry's dispatch rules.
 *
 * These are the parts of A11Y-1 to A11Y-8 that are pure logic — which
 * key resolves to which action, and how a chord opens, matches, and
 * fails. The DOM-level rules (typing suppression, dialog suppression)
 * are in `useShortcuts.test.ts`; the end-to-end effects are in
 * `tests/ui/flow-accessibility.spec.ts`.
 */
describe("the global shortcut table", () => {
  // @verifies A11Y-4
  it("has no duplicate binding, so every key resolves to one action", () => {
    // A11Y-4's second bullet turns on the list and the bindings being
    // the same thing. The failure this catches is two entries claiming
    // the same key: the dialog would list both, `resolveShortcut`
    // would silently pick the first, and the reference would be
    // documenting an action that never fires.
    const seen = new Set<string>();
    for (const b of GLOBAL_SHORTCUTS.flatMap(s => s.bindings)) {
      const combo = b.keys.join(" ");
      expect(seen.has(combo), `duplicate binding for ${combo}`).toBe(false);
      seen.add(combo);
    }
  });

  // @verifies A11Y-4
  it("gives every shortcut a description and a group for the reference", () => {
    // A shortcut with an empty action string renders as a blank row in
    // the `?` dialog — listed, but documenting nothing.
    for (const s of GLOBAL_SHORTCUTS) {
      expect(s.action.length, `${s.id} has no action text`).toBeGreaterThan(0);
      expect(s.group.length, `${s.id} has no group`).toBeGreaterThan(0);
      expect(s.bindings.length, `${s.id} has no keys`).toBeGreaterThan(0);
    }
  });

  // @verifies A11Y-1
  it("binds `n` to create, and does not bind `c` as an alias", () => {
    expect(resolveShortcut("n", null)).toEqual({ kind: "fire", command: "new-task" });
    // A11Y-1's fourth bullet is explicit that `c` must not be a second
    // alias: "one binding, one action — a second alias is a key that
    // cannot then be used for anything else". Asserted as a positive
    // control beside the `n` binding so this cannot pass by the whole
    // table being empty.
    expect(resolveShortcut("c", null)).toEqual({ kind: "none" });
  });

  // Deliberately NOT tagged as verifying that case. The binding exists,
  // but the case requires focus to land in a search input, and the
  // app's only global search box is disabled (see decisions.md A84 and
  // known-gaps.md). Claiming the case from a test of the table alone
  // would be asserting the label rather than the effect.
  it("binds `/` to the search box", () => {
    expect(resolveShortcut("/", null)).toEqual({ kind: "fire", command: "focus-search" });
  });

  // @verifies A11Y-6
  it("binds `[` to the sidebar", () => {
    expect(resolveShortcut("[", null)).toEqual({ kind: "fire", command: "toggle-sidebar" });
  });

  // @verifies A11Y-7
  it("binds `t` to the theme", () => {
    expect(resolveShortcut("t", null)).toEqual({ kind: "fire", command: "cycle-theme" });
  });

  // @verifies A11Y-4
  it("binds `?` to the reference, and the reference documents itself", () => {
    expect(resolveShortcut("?", null)).toEqual({ kind: "fire", command: "shortcut-help" });
    // A help dialog that does not document how it was opened is the
    // one row a user cannot look up.
    expect(GLOBAL_SHORTCUTS.some(s => s.id === "shortcut-help")).toBe(true);
  });
});

describe("chords", () => {
  // @verifies A11Y-3
  it("treats `g` as a prefix rather than firing an action", () => {
    expect(isChordPrefix("g")).toBe(true);
    expect(resolveShortcut("g", null)).toEqual({ kind: "chord-start", prefix: "g" });
  });

  // @verifies A11Y-3
  it("resolves g-l, g-b and g-t to the three routes", () => {
    expect(resolveShortcut("l", "g")).toEqual({ kind: "fire", command: "goto-list" });
    expect(resolveShortcut("b", "g")).toEqual({ kind: "fire", command: "goto-board" });
    expect(resolveShortcut("t", "g")).toEqual({ kind: "fire", command: "goto-timeline" });
  });

  // @verifies A11Y-3
  it("makes `g` then an unmapped key a no-op, not a stuck state", () => {
    // A11Y-3's third bullet. `z` is not a second key of any chord, so
    // it must resolve to nothing — and critically, not to a
    // `chord-start` that would leave the prefix armed.
    expect(resolveShortcut("z", "g")).toEqual({ kind: "none" });
  });

  // @verifies A11Y-3
  it("does not fire the single-key action for a chord's second key", () => {
    // `t` alone cycles the theme; `g` then `t` goes to the timeline.
    // The bug this catches is a resolver that checks single keys
    // first, which would flip the theme instead of navigating — and
    // would leave `g t` permanently broken while every direct test of
    // `t` still passed.
    expect(resolveShortcut("t", "g")).toEqual({ kind: "fire", command: "goto-timeline" });
    expect(resolveShortcut("t", null)).toEqual({ kind: "fire", command: "cycle-theme" });
  });

  // @verifies A11Y-3
  it("does not treat a chord's second key as a prefix on its own", () => {
    // `l`, `b` and `t` must not arm a chord when pressed with nothing
    // pending, or every `t` would swallow the following keystroke.
    expect(isChordPrefix("l")).toBe(false);
    expect(isChordPrefix("b")).toBe(false);
  });
});

/**
 * K133's off switches (A11Y-43, WCAG 2.1.4): single-key shortcuts can
 * be turned off, all at once or one by one. `resolveShortcut` takes the
 * user's resolved switches as a filter; these pin what "off" means at
 * the dispatch level.
 */
describe("off switches", () => {
  const allOff = (): boolean => false;
  const offExcept = (...ids: string[]) => (id: string): boolean => ids.includes(id);
  const onExcept = (...ids: string[]) => (id: string): boolean => !ids.includes(id);

  // @verifies A11Y-43
  it("resolves nothing for any key when every shortcut is off", () => {
    for (const key of ["n", "/", "[", "t", "?"]) {
      expect(resolveShortcut(key, null, allOff), key).toEqual({ kind: "none" });
    }
    // And `g` does not arm a chord with nothing to complete.
    expect(resolveShortcut("g", null, allOff)).toEqual({ kind: "none" });
  });

  // @verifies A11Y-43
  it("silences only the shortcut switched off, leaving the rest bound", () => {
    const isOn = onExcept("new-task");
    expect(resolveShortcut("n", null, isOn)).toEqual({ kind: "none" });
    // Positive control: a neighbour still fires, so this cannot pass by
    // the filter silencing everything.
    expect(resolveShortcut("t", null, isOn)).toEqual({ kind: "fire", command: "cycle-theme" });
    expect(resolveShortcut("g", null, isOn)).toEqual({ kind: "chord-start", prefix: "g" });
  });

  // @verifies A11Y-43
  // @verifies A11Y-57
  it("does not arm `g` when the Go-to shortcut is off, so the next key is not swallowed", () => {
    const isOn = onExcept("goto");
    expect(isChordPrefix("g", isOn)).toBe(false);
    expect(resolveShortcut("g", null, isOn)).toEqual({ kind: "none" });
    // The key after `g` resolves on its own: `t` cycles the theme
    // rather than being eaten as the tail of a dead chord.
    expect(resolveShortcut("t", null, isOn)).toEqual({ kind: "fire", command: "cycle-theme" });
  });

  // @verifies A11Y-43
  it("treats the three `g` sequences as one shortcut with one switch", () => {
    const isOn = offExcept("goto");
    expect(resolveShortcut("l", "g", isOn)).toEqual({ kind: "fire", command: "goto-list" });
    expect(resolveShortcut("b", "g", isOn)).toEqual({ kind: "fire", command: "goto-board" });
    expect(resolveShortcut("t", "g", isOn)).toEqual({ kind: "fire", command: "goto-timeline" });
    const gotoOff = onExcept("goto");
    expect(resolveShortcut("l", "g", gotoOff)).toEqual({ kind: "none" });
  });
});
