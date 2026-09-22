// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./Button.tsx";
import { DialogActions } from "./Dialog.tsx";
import { ResponsiveDialog } from "./ResponsiveDialog.tsx";

afterEach(cleanup);

/**
 * `ResponsiveDialog` is the responsive overlay primitive: a centered
 * `Dialog` at desktop width and a bottom `Sheet` below the 640px mobile
 * breakpoint, from ONE content slot. jsdom has no `matchMedia`, so
 * `useIsNarrow` reads `window.innerWidth`; setting it drives the mode.
 *
 * The mode switch is the load-bearing behaviour, so it is red-proofed:
 * the desktop assertion fails if the primitive always renders the Sheet
 * (the Sheet has a close button, which the desktop Dialog does not), and
 * the mobile assertion fails if it always renders the Dialog (only the
 * Sheet path carries the panel testid + close button).
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

const actions = (
  <DialogActions>
    <Button testId="rd-cancel">Cancel</Button>
    <Button variant="primary" testId="rd-save">Save</Button>
  </DialogActions>
);

describe("ResponsiveDialog", () => {
  it("renders a centered dialog (no Sheet close button) at desktop width", () => {
    withWidth(1200, () => {
      render(
        <ResponsiveDialog title="Edit thing" onClose={() => {}} testId="rd" actions={actions}>
          <input aria-label="Name" data-testid="rd-field" />
        </ResponsiveDialog>,
      );
      const dlg = screen.getByRole("dialog");
      expect(dlg.getAttribute("aria-modal")).toBe("true");
      expect(dlg.getAttribute("aria-label")).toBe("Edit thing");
      // The children and actions render in this mode.
      expect(screen.getByTestId("rd-field")).toBeTruthy();
      expect(screen.getByTestId("rd-save")).toBeTruthy();
      // Distinguishing marker: the desktop Dialog has NO Sheet close ✕.
      // If the primitive always rendered the Sheet, this would exist.
      expect(screen.queryByTestId("rd-close")).toBeNull();
    });
  });

  it("renders a bottom sheet (with its close button) at narrow width", () => {
    withWidth(375, () => {
      render(
        <ResponsiveDialog title="Edit thing" onClose={() => {}} testId="rd" actions={actions}>
          <input aria-label="Name" data-testid="rd-field" />
        </ResponsiveDialog>,
      );
      const dlg = screen.getByRole("dialog");
      expect(dlg.getAttribute("aria-modal")).toBe("true");
      expect(dlg.getAttribute("aria-label")).toBe("Edit thing");
      // The SAME children + actions render — no forked state.
      expect(screen.getByTestId("rd-field")).toBeTruthy();
      expect(screen.getByTestId("rd-save")).toBeTruthy();
      // Distinguishing marker: only the Sheet path has the ✕ close button.
      // If the primitive always rendered the Dialog, this would be null.
      expect(screen.getByTestId("rd-close")).toBeTruthy();
    });
  });

  it("keeps the testid stable across the mode switch (specs locate it either way)", () => {
    withWidth(1200, () => {
      render(
        <ResponsiveDialog title="T" onClose={() => {}} testId="my-editor">
          <p>body</p>
        </ResponsiveDialog>,
      );
      expect(screen.getByTestId("my-editor")).toBeTruthy();
    });
    cleanup();
    withWidth(375, () => {
      render(
        <ResponsiveDialog title="T" onClose={() => {}} testId="my-editor">
          <p>body</p>
        </ResponsiveDialog>,
      );
      expect(screen.getByTestId("my-editor")).toBeTruthy();
    });
  });

  it("closes on Escape at BOTH widths (shared a11y machinery, not reimplemented)", () => {
    for (const width of [1200, 375]) {
      const onClose = vi.fn();
      withWidth(width, () => {
        render(
          <ResponsiveDialog title="T" onClose={onClose}>
            <p>b</p>
          </ResponsiveDialog>,
        );
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      cleanup();
    }
  });

  it("closes on a backdrop click at BOTH widths", () => {
    for (const width of [1200, 375]) {
      const onClose = vi.fn();
      withWidth(width, () => {
        render(
          <ResponsiveDialog title="T" onClose={onClose}>
            <p>b</p>
          </ResponsiveDialog>,
        );
        const dlg = screen.getByRole("dialog");
        // The backdrop is the dialog panel's parent (the fixed inset-0 layer).
        const backdrop = dlg.parentElement as HTMLElement;
        fireEvent.mouseDown(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      cleanup();
    }
  });

  it("traps focus at BOTH widths (focusable content receives focus)", () => {
    for (const width of [1200, 375]) {
      withWidth(width, () => {
        render(
          <ResponsiveDialog title="T" onClose={() => {}}>
            <button type="button" data-testid="rd-inner">Inner</button>
          </ResponsiveDialog>,
        );
        // useFocusTrap moves focus into the panel on mount; focus is not
        // left on document.body.
        expect(document.activeElement).not.toBe(document.body);
        expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
      });
      cleanup();
    }
  });
});
