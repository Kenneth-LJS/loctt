// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./Button.tsx";
import { Dialog, DialogActions } from "./Dialog.tsx";

afterEach(cleanup);

/**
 * Dialog is a thin wrapper over the existing Modal. The tests assert it
 * inherits Modal's accessibility apparatus (dialog role, aria-modal,
 * Escape close) rather than re-implementing a card — a bare <div> wrapper
 * would fail these.
 */
describe("Dialog", () => {
  it("renders through Modal with the dialog role and aria-modal", () => {
    render(
      <Dialog title="Edit status" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Edit status");
    // Modal owns the heading.
    expect(screen.getByRole("heading", { name: "Edit status" })).toBeTruthy();
  });

  it("closes on Escape (inherited from Modal, not re-implemented)", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="T" onClose={onClose}>
        <p>b</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an optional description and the body", () => {
    render(
      <Dialog title="T" onClose={() => {}} description="Removes it from queries.yaml">
        <p>the body</p>
      </Dialog>,
    );
    expect(screen.getByText("Removes it from queries.yaml")).toBeTruthy();
    expect(screen.getByText("the body")).toBeTruthy();
  });

  it("renders a DialogActions footer with its buttons", () => {
    render(
      <Dialog
        title="T"
        onClose={() => {}}
        actions={
          <DialogActions>
            <Button>Cancel</Button>
            <Button variant="danger" testId="confirm">
              Delete
            </Button>
          </DialogActions>
        }
      >
        <p>b</p>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByTestId("confirm")).toBeTruthy();
  });

  it("passes testId onto the body wrapper", () => {
    render(
      <Dialog title="T" onClose={() => {}} testId="edit-status-dialog">
        <p>b</p>
      </Dialog>,
    );
    expect(screen.getByTestId("edit-status-dialog")).toBeTruthy();
  });
});

/**
 * SET-8: a tall dialog's actions stay reachable.
 *
 * The custom-field editor with a list of enum values measures ~823px; in
 * a 720px-tall window the panel had no `max-h` at all, so the overlay
 * centred an over-tall card and Save landed below the fold with nothing
 * to scroll. The user could not save.
 *
 * jsdom does no layout, so these cannot measure pixels — measuring a
 * fabricated height would assert nothing anyway. What they pin is the
 * structural contract that produces the behaviour, and each one
 * identifies the element by its ROLE in the layout (the panel; the
 * element the footer is in; the element the body is in) rather than by
 * a class string on a known div:
 *
 *   1. the panel is capped, so it cannot exceed the viewport;
 *   2. the actions are NOT inside the scrolling region, so scrolling the
 *      body can never move them off-screen;
 *   3. the body IS the scrolling region, so overflow has somewhere to go
 *      rather than being clipped.
 *
 * Together those are exactly "the footer is reachable at any content
 * height". Any one of them alone is satisfiable by the broken layout.
 */
describe("Dialog tall-content layout (SET-8)", () => {
  function renderTall() {
    render(
      <Dialog
        title="New custom field"
        onClose={() => {}}
        testId="custom-field-dialog"
        actions={
          <DialogActions>
            <Button testId="cf-cancel">Cancel</Button>
            <Button variant="primary" testId="cf-save">Save</Button>
          </DialogActions>
        }
      >
        <p data-testid="cf-body">a very tall body</p>
      </Dialog>,
    );
    return {
      panel: screen.getByRole("dialog"),
      save: screen.getByTestId("cf-save"),
      body: screen.getByTestId("cf-body"),
    };
  }

  /** The nearest ancestor of `el` (up to `stop`) that scrolls vertically. */
  const scrollParent = (el: HTMLElement, stop: HTMLElement): HTMLElement | null => {
    let cur: HTMLElement | null = el.parentElement;
    while (cur !== null && cur !== stop.parentElement) {
      if (/overflow-y-auto|overflow-auto/.test(cur.className)) return cur;
      cur = cur.parentElement;
    }
    return null;
  };

  it("caps the panel's height so it cannot grow past the viewport", () => {
    const { panel } = renderTall();
    // Without a cap the panel is as tall as its content and the overlay
    // centres it, pushing both ends off-screen.
    expect(panel.className).toMatch(/max-h-/);
  });

  it("keeps the actions OUTSIDE the scrolling body, so they cannot scroll away", () => {
    const { panel, save } = renderTall();
    expect(scrollParent(save, panel)).toBeNull();
  });

  it("makes the body the scrolling region, so tall content has somewhere to go", () => {
    const { panel, body } = renderTall();
    const scroller = scrollParent(body, panel);
    expect(scroller).not.toBeNull();
    // And it is allowed to shrink below its content — a flex item's
    // default `min-height: auto` is exactly how an over-tall body grows
    // the panel past its own cap and strands the footer again.
    expect(scroller?.className).toContain("min-h-0");
  });

  it("still scopes the action buttons inside the dialog's testid", () => {
    // The fix moves the footer out of the SCROLLER, not out of the
    // testid wrapper: a great many specs do
    // `within(getByTestId(dialog)).getByTestId("…-save")`.
    renderTall();
    const wrapper = screen.getByTestId("custom-field-dialog");
    expect(wrapper.contains(screen.getByTestId("cf-save"))).toBe(true);
    expect(wrapper.contains(screen.getByTestId("cf-body"))).toBe(true);
  });
});

describe("DialogActions", () => {
  it("right-aligns with a consistent gap so no dialog re-spells the footer", () => {
    render(
      <DialogActions>
        <span>a</span>
      </DialogActions>,
    );
    const row = screen.getByText("a").parentElement;
    expect(row?.className).toContain("justify-end");
    expect(row?.className).toContain("gap-2");
  });
});
