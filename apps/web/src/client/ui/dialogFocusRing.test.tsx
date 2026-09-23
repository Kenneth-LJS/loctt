// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Modal } from "./Modal.tsx";
import { ResponsiveDialog } from "./ResponsiveDialog.tsx";
import { Sheet } from "./Sheet.tsx";

afterEach(cleanup);

/**
 * UI-11 — the focus ring on a control at the edge of a dialog body was
 * clipped: cut flat on the bottom while the opposite corners stayed
 * rounded. Ken hit it twice (a date input, then Edit sprint's Goal
 * textarea).
 *
 * ## What these tests can and cannot see
 *
 * They CANNOT see the bug. jsdom does no layout and paints nothing, so
 * there is no clipped outline to assert on — `getBoundingClientRect` is
 * all zeros and `outline` is never rendered. **Visual confirmation came
 * from the browser, not from these tests**: measured on the live dev
 * server, Edit sprint's Goal textarea had exactly 0px of bottom
 * clearance inside a scroller whose ring needs 4px, and 7px after the
 * fix.
 *
 * What they CAN see is the MECHANISM, which is what actually regresses:
 * the class strings on the body scroller. Each dialog body is an
 * `overflow-y-auto` scroller, and `overflow-y: auto` clips on EVERY edge
 * (it scrolls vertically but still clips horizontally). So the ring's
 * clearance has to exist as padding INSIDE the scroller — padding is
 * part of the scrollable box, so it survives scrolling to either end,
 * where a gap outside the scroller would not.
 *
 * These tests therefore assert the padding/margin relationship per
 * primitive. That is a real regression guard: the defect was introduced
 * by a scroller carrying `px-4` and no `py`, and would be reintroduced
 * by anyone "tidying" `p-4` down to `px-4`.
 */

/** The global ring is `outline: 2px` at `outline-offset: 2px`. */
const RING_CLEARANCE_PX = 4;

/** This app sets a 14px root font size, so Tailwind's rem spacing scales. */
const ROOT_FONT_PX = 14;
const remToPx = (rem: number): number => rem * ROOT_FONT_PX;

/** Tailwind spacing steps, in the px they resolve to in THIS app. */
const SPACING_PX: Record<string, number> = {
  "1": remToPx(0.25), // 3.5px — under the ring's 4px
  "1.5": remToPx(0.375), // 5.25px
  "2": remToPx(0.5), // 7px
  "3": remToPx(0.75), // 10.5px
  "4": remToPx(1), // 14px
};

/**
 * Reads the padding step a scroller declares on one axis.
 *
 * Matches `p-N`, `px-N`/`py-N` — the forms these primitives use —
 * and returns the step, or null when the axis has no padding at all
 * (which is exactly the UI-11 state).
 */
function paddingStep(classes: string, axis: "x" | "y"): string | null {
  const tokens = classes.split(/\s+/);
  for (const prefix of [`p${axis}-`, "p-"]) {
    const hit = tokens.find(t => t.startsWith(prefix));
    if (hit !== undefined) return hit.slice(prefix.length);
  }
  return null;
}

/** Reads the compensating negative-margin step on one axis, if any. */
function negativeMarginStep(classes: string, axis: "x" | "y"): string | null {
  const tokens = classes.split(/\s+/);
  for (const prefix of [`-m${axis}-`, "-m-"]) {
    const hit = tokens.find(t => t.startsWith(prefix));
    if (hit !== undefined) return hit.slice(prefix.length);
  }
  return null;
}

/** The `overflow-y-auto` body scroller inside a rendered dialog. */
function bodyScroller(): HTMLElement {
  const dlg = screen.getByRole("dialog");
  const sc = dlg.querySelector<HTMLElement>(".overflow-y-auto");
  if (sc === null) throw new Error("no overflow-y-auto body scroller found");
  return sc;
}

/**
 * The core invariant, asserted the same way for every primitive.
 *
 * On BOTH axes the scroller must reserve at least the ring's 4px inside
 * its own clip boundary. `overflow-y: auto` clips horizontally as well
 * as vertically, so neither axis is exempt.
 */
function expectRingClearanceOnBothAxes(classes: string): void {
  for (const axis of ["x", "y"] as const) {
    const step = paddingStep(classes, axis);
    expect(
      step,
      `scroller has no padding on the ${axis} axis, so a control at that `
        + `edge has its focus ring clipped (UI-11). classes: "${classes}"`,
    ).not.toBeNull();

    const px = SPACING_PX[step as string];
    expect(px, `unknown spacing step "${step}" — add it to SPACING_PX`).toBeDefined();
    expect(
      px,
      `${axis}-axis padding is ${String(px)}px, under the ${RING_CLEARANCE_PX}px `
        + `the focus ring needs (outline 2px @ offset 2px)`,
    ).toBeGreaterThanOrEqual(RING_CLEARANCE_PX);
  }
}

describe("UI-11: dialog bodies reserve focus-ring clearance inside the scroller", () => {
  describe("Modal", () => {
    it("pads BOTH axes of the body scroller, so the last control's ring is not clipped", () => {
      render(
        <Modal title="Edit sprint" onClose={() => {}} footer={<button type="button">Save</button>}>
          <input aria-label="Name" />
          <textarea aria-label="Goal" />
        </Modal>,
      );
      // The y axis is the half UI-11 shipped without: the scroller had
      // `px-4` and no `py`, so Edit sprint's Goal textarea sat flush on
      // the clip boundary with 0px for a ring needing 4px.
      expectRingClearanceOnBothAxes(bodyScroller().className);
    });

    it("compensates each padding with an equal negative margin, so layout is unchanged", () => {
      render(
        <Modal title="T" onClose={() => {}}>
          <input aria-label="N" />
        </Modal>,
      );
      const classes = bodyScroller().className;
      // The padding buys ring clearance; the negative margin gives the
      // space back, so the body still starts and ends where it did.
      // Without this pairing the fix would visibly inset the content.
      for (const axis of ["x", "y"] as const) {
        expect(
          negativeMarginStep(classes, axis),
          `${axis}-axis padding is not compensated by a negative margin, so `
            + `the fix would inset the body. classes: "${classes}"`,
        ).toBe(paddingStep(classes, axis));
      }
    });

    it("keeps min-h-0 on the scroller, so a tall body cannot strand the footer", () => {
      render(
        <Modal title="T" onClose={() => {}} footer={<button type="button">Save</button>}>
          <input aria-label="N" />
        </Modal>,
      );
      // The vertical padding added for UI-11 sits on the same element as
      // the `min-h-0` that stops an over-tall body growing the panel past
      // its `max-h` (SET-8). If a later edit drops `min-h-0` while
      // reshuffling the padding, the footer becomes unreachable again.
      expect(bodyScroller().className).toContain("min-h-0");
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });

    it("renders the footer outside the scroller, so it cannot scroll out of reach", () => {
      render(
        <Modal title="T" onClose={() => {}} footer={<button type="button">Save</button>}>
          <input aria-label="N" />
        </Modal>,
      );
      const save = screen.getByRole("button", { name: "Save" });
      expect(
        bodyScroller().contains(save),
        "the footer is inside the scrolling body, so it scrolls away (SET-8)",
      ).toBe(false);
    });
  });

  describe("Sheet", () => {
    it("pads BOTH axes of the body scroller (its `p-4` is load-bearing, not inset styling)", () => {
      render(
        <Sheet title="Filters" onClose={() => {}}>
          <button type="button">Export JSON</button>
        </Sheet>,
      );
      // Measured in-browser: the Sheet was already correct here — `p-4`
      // gives 14px on all four edges. This test exists so narrowing it to
      // `px-4` cannot silently re-open UI-11 on the mobile branch.
      expectRingClearanceOnBothAxes(bodyScroller().className);
    });
  });

  describe("ResponsiveDialog", () => {
    /**
     * jsdom has no matchMedia, so `useIsNarrow` reads `window.innerWidth`.
     * Both branches are checked, because the primitive delegates to a
     * different scroller at each width.
     */
    function withWidth(value: number, fn: () => void): void {
      const original = window.innerWidth;
      Object.defineProperty(window, "innerWidth", { configurable: true, value });
      try {
        fn();
      } finally {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
      }
    }

    it("inherits clearance on BOTH axes at desktop width (delegates to Dialog → Modal)", () => {
      withWidth(1200, () => {
        render(
          <ResponsiveDialog title="Edit thing" onClose={() => {}}>
            <textarea aria-label="Goal" />
          </ResponsiveDialog>,
        );
        expectRingClearanceOnBothAxes(bodyScroller().className);
      });
    });

    it("inherits clearance on BOTH axes at narrow width (delegates to Sheet)", () => {
      withWidth(375, () => {
        render(
          <ResponsiveDialog title="Edit thing" onClose={() => {}}>
            <textarea aria-label="Goal" />
          </ResponsiveDialog>,
        );
        expectRingClearanceOnBothAxes(bodyScroller().className);
      });
    });
  });
});
