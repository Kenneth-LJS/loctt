// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHORD_TIMEOUT_MS } from "./shortcuts.ts";
import { useShortcuts } from "./useShortcuts.ts";

/**
 * The dispatcher's DOM-level rules.
 *
 * `shortcuts.test.ts` covers which key means what; this covers when a
 * key is allowed to mean it at all — A11Y-1's typing guard, A11Y-8's
 * "a modal owns the keyboard", A11Y-43's modifier rule, and A11Y-3's
 * chord timeout.
 */

function press(key: string, target: EventTarget = window, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("suppression", () => {
  // @verifies A11Y-1
  it("does not fire while a text input has focus, so the letter types", () => {
    const onNew = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useShortcuts({ "new-task": onNew }));

    press("n", input);

    // A11Y-1's third bullet: typing `n` into a title must insert `n`,
    // which means the handler must not run *and* the event must not be
    // defaulted away.
    expect(onNew).not.toHaveBeenCalled();
  });

  // A11Y-2's *third* bullet only, and deliberately NOT tagged as the
  // case: its first two bullets need a focusable search box, which
  // this build does not have (decisions.md A84). Tagging the case here
  // would report it covered while a keyboard user still cannot reach
  // search at all.
  it("does not fire `/` inside a field, so a literal slash is inserted", () => {
    const onSearch = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useShortcuts({ "focus-search": onSearch }));

    press("/", input);

    // A11Y-2's third bullet is the inverse of its first: `/` outside a
    // field focuses search, `/` inside one is a character.
    expect(onSearch).not.toHaveBeenCalled();
  });

  // @verifies A11Y-7
  it("does not cycle the theme while a textarea has focus", () => {
    const onTheme = vi.fn();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    renderHook(() => useShortcuts({ "cycle-theme": onTheme }));

    press("t", textarea);

    expect(onTheme).not.toHaveBeenCalled();
  });

  // @verifies A11Y-8
  it("is suppressed entirely while a dialog owns the keyboard", () => {
    const onGotoBoard = vi.fn();
    const onNew = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    renderHook(() => useShortcuts({ "goto-board": onGotoBoard, "new-task": onNew }));

    // A11Y-8's first bullet: with the create modal open, `g` then `b`
    // performs no navigation.
    press("g");
    press("b");
    press("n");

    expect(onGotoBoard).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });

  // @verifies A11Y-8
  it("resumes once the dialog closes", () => {
    const onGotoBoard = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    renderHook(() => useShortcuts({ "goto-board": onGotoBoard }));

    press("g");
    press("b");
    expect(onGotoBoard).not.toHaveBeenCalled();

    // A11Y-8's second bullet. This is the positive control for the
    // test above: without it, a hook that ignored *every* key would
    // pass the suppression assertion just as well.
    dialog.remove();
    press("g");
    press("b");
    expect(onGotoBoard).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-43
  it("leaves modifier combinations to the browser", () => {
    const onTheme = vi.fn();
    renderHook(() => useShortcuts({ "cycle-theme": onTheme }));

    // A11Y-43's second bullet: no shortcut overrides a
    // browser-reserved combination. Cmd/Ctrl+T is a new tab.
    press("t", window, { metaKey: true });
    press("t", window, { ctrlKey: true });
    press("t", window, { altKey: true });
    expect(onTheme).not.toHaveBeenCalled();

    // Positive control: the bare key does fire, so the assertion above
    // is about the modifier and not about `t` being unbound.
    press("t");
    expect(onTheme).toHaveBeenCalledTimes(1);
  });
});

describe("dispatch and chords", () => {
  // @verifies A11Y-1
  it("fires a single-key shortcut with nothing focused", () => {
    const onNew = vi.fn();
    renderHook(() => useShortcuts({ "new-task": onNew }));
    press("n");
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-3
  it("navigates on the g-l, g-b and g-t chords", () => {
    const list = vi.fn();
    const board = vi.fn();
    const timeline = vi.fn();
    renderHook(() =>
      useShortcuts({ "goto-list": list, "goto-board": board, "goto-timeline": timeline }),
    );

    press("g");
    press("l");
    press("g");
    press("b");
    press("g");
    press("t");

    expect(list).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledTimes(1);
    expect(timeline).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-3
  it("forgets the prefix after the chord window", () => {
    vi.useFakeTimers();
    const list = vi.fn();
    const onNew = vi.fn();
    renderHook(() => useShortcuts({ "goto-list": list, "new-task": onNew }));

    press("g");
    // A11Y-3's second bullet: "pressing `g`, waiting several seconds,
    // then `l` does not navigate".
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1);
    press("l");
    expect(list).not.toHaveBeenCalled();

    // And the expired prefix did not leave the dispatcher wedged —
    // this is the "not a stuck state" half, asserted with a key that
    // has a handler so a silent no-op cannot pass it.
    press("n");
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-3
  it("does not stay armed after `g` then an unmapped key", () => {
    const list = vi.fn();
    const onTheme = vi.fn();
    renderHook(() => useShortcuts({ "goto-list": list, "cycle-theme": onTheme }));

    press("g");
    press("z"); // unmapped second key
    expect(list).not.toHaveBeenCalled();

    // A11Y-3's third bullet: the next keystroke is handled normally
    // rather than being swallowed as another chord attempt.
    press("t");
    expect(onTheme).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-3
  it("prefers the chord over the second key's own binding", () => {
    const timeline = vi.fn();
    const onTheme = vi.fn();
    renderHook(() => useShortcuts({ "goto-timeline": timeline, "cycle-theme": onTheme }));

    press("g");
    press("t");

    // `t` alone cycles the theme, but after `g` it must navigate. A
    // dispatcher that checked single keys first would flip the theme
    // and never reach the timeline.
    expect(timeline).toHaveBeenCalledTimes(1);
    expect(onTheme).not.toHaveBeenCalled();
  });

  // @verifies A11Y-3
  it("lets an unhandled key reach the page rather than defaulting it away", () => {
    const onNew = vi.fn();
    renderHook(() => useShortcuts({ "new-task": onNew }));

    // A route that registers no handler for `[` must not swallow it —
    // `preventDefault` on a key nothing handles is how a shortcut
    // system breaks find-in-page and native controls.
    const event = new KeyboardEvent("keydown", { key: "[", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    // Positive control: a key that *is* handled is defaulted away, so
    // the assertion above is about the missing handler.
    const handled = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    window.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
  });

  // @verifies A11Y-8
  it("stops listening when unmounted", () => {
    const onNew = vi.fn();
    const { unmount } = renderHook(() => useShortcuts({ "new-task": onNew }));
    unmount();
    press("n");
    expect(onNew).not.toHaveBeenCalled();
  });
});
