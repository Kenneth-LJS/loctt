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
