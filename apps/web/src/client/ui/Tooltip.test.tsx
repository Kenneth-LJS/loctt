// @vitest-environment jsdom
import * as matchers from "@testing-library/jest-dom/matchers";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconButton } from "./IconButton.tsx";
import { Tooltip, TOOLTIP_DELAY_MS } from "./Tooltip.tsx";

// `toHaveAccessibleName`/`toHaveAccessibleDescription` compute the real
// a11y name and description (the same engine a screen reader uses),
// rather than reading an attribute. That is the point: this file asserts
// what a reader would say, not which attribute produced it. Registered
// locally — this suite has no global setup file.
expect.extend(matchers);

/**
 * `ui/Tooltip` (UI-23e).
 *
 * The regressions these guard are the ones that make an icon-only
 * control unusable for somebody: it never appears for a keyboard user,
 * it cannot be dismissed, or it makes a screen reader say the button's
 * name twice.
 *
 * jsdom has no `:focus-visible` matching, so the two focus tests stub
 * `Element.matches` for that selector only — the component asks the
 * platform the question and jsdom always answers "no", which would make
 * a keyboard-focus tooltip untestable rather than working.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

/**
 * Make `:focus-visible` answer true, as a real keyboard focus would.
 *
 * Only that one selector is intercepted; anything else is delegated to
 * the real `matches` via `Reflect.apply` on the prototype, which keeps
 * the calling element as `this` without lifting the method into an
 * unbound variable (the `unbound-method` hazard).
 */
function stubFocusVisible(): void {
  const proto = Element.prototype;
  const real = Object.getOwnPropertyDescriptor(proto, "matches")
    ?.value as (this: Element, sel: string) => boolean;
  function stub(this: Element, sel: string): boolean {
    if (sel === ":focus-visible") return true;
    return Reflect.apply(real, this, [sel]);
  }
  vi.spyOn(proto, "matches").mockImplementation(stub);
}

function renderTip(props: { describes?: boolean } = {}) {
  render(
    <Tooltip label="Save as view" testId="tip" {...props}>
      <IconButton aria-label="Save as view" testId="trigger">
        ★
      </IconButton>
    </Tooltip>,
  );
  return screen.getByTestId("trigger");
}

describe("Tooltip", () => {
  it("appears on keyboard focus, which is the whole point of not using `title`", () => {
    stubFocusVisible();
    const trigger = renderTip();
    expect(screen.queryByTestId("tip")).toBeNull();

    fireEvent.focus(trigger);

    // Instant: no timer advanced. Focus is deliberate, so a delay would
    // only look broken — and `title` never appears on focus at all,
    // which is the defect this primitive exists to fix.
    expect(screen.getByTestId("tip")).toBeTruthy();
  });

  it("does NOT appear for the focus a mouse click leaves behind", () => {
    // `:focus-visible` is false here (no stub), as after a click.
    const trigger = renderTip();
    fireEvent.focus(trigger);
    expect(screen.queryByTestId("tip")).toBeNull();
  });

  it("waits out the enter delay on hover, then shows", () => {
    const trigger = renderTip();

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    // Still hidden one tick before the delay elapses: a pointer merely
    // sweeping across a toolbar must not strobe a bubble per button.
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1); });
    expect(screen.queryByTestId("tip")).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId("tip")).toBeTruthy();
  });

  it("cancels a pending tooltip when the pointer leaves mid-delay", () => {
    const trigger = renderTip();
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 4); });
    // The regression: a timer that fires after the pointer has gone
    // leaves a bubble stuck over the page with nothing to dismiss it.
    expect(screen.queryByTestId("tip")).toBeNull();
  });

  it("ignores touch, where there is no hover to speak of", () => {
    const trigger = renderTip();
    fireEvent.pointerEnter(trigger, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 4); });
    // A bubble raised by a tap has no dismiss gesture and covers the
    // thing just tapped. The name stays on `aria-label`.
    expect(screen.queryByTestId("tip")).toBeNull();
    expect(trigger).toHaveAccessibleName("Save as view");
  });

  it("dismisses on Escape", () => {
    stubFocusVisible();
    const trigger = renderTip();
    fireEvent.focus(trigger);
    expect(screen.getByTestId("tip")).toBeTruthy();

    // On the document, not the trigger: a tooltip raised by HOVER has
    // no focus near it, so a trigger-local handler would never hear it.
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("tip")).toBeNull();
  });

  it("is not announced twice when the trigger already has the same aria-label", () => {
    stubFocusVisible();
    const trigger = renderTip();
    fireEvent.focus(trigger);

    // Visible, so a sighted user reads it...
    expect(screen.getByTestId("tip")).toBeTruthy();
    // ...but out of the a11y tree, and not wired as a description, so a
    // reader says "Save as view, button" once — not twice.
    expect(screen.getByTestId("tip").getAttribute("aria-hidden")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(trigger).toHaveAccessibleDescription("");
    expect(trigger).toHaveAccessibleName("Save as view");
  });

  it("describes the trigger — without hover — when `describes` is set", () => {
    render(
      <Tooltip label="the full untruncated summary" describes testId="tip">
        <button type="button" data-testid="trigger" aria-label="Edit view">
          Edit
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");

    // No pointer, no focus: a screen-reader user never hovers, so the
    // description must exist anyway. The regression this catches is
    // wiring `aria-describedby` to the hover-only bubble, which dangles
    // whenever the bubble is closed — i.e. essentially always.
    expect(screen.queryByTestId("tip")).toBeNull();
    expect(trigger).toHaveAccessibleDescription("the full untruncated summary");
    // The name is still the name: the description did not replace it.
    expect(trigger).toHaveAccessibleName("Edit view");
  });

  it("never shows an empty bubble when the label is blank", () => {
    stubFocusVisible();
    render(
      <Tooltip label="" describes testId="tip">
        <button type="button" data-testid="trigger">Go</button>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");

    // Hover AND focus — both paths, because the guard returns the
    // trigger unwrapped and so must suppress both. Without it a blank
    // label renders an empty bubble floating over the page, and
    // `describes` wires an empty description onto the trigger.
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 4); });
    fireEvent.focus(trigger);

    expect(screen.queryByTestId("tip")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    // The trigger itself is still rendered and still named.
    expect(trigger).toHaveAccessibleName("Go");
  });
});
