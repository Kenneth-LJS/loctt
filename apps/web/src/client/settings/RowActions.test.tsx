// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowActions } from "./RowActions.tsx";

afterEach(cleanup);

/**
 * A disabled row action is genuinely disabled (A11Y-31 / PRU-26 / PRU-33).
 *
 * `RowActions` used to express "unavailable" by dropping `onSelect` and
 * adding `opacity-50`, with the reason on an inner `<span>`. That is the
 * defect A11Y-31's third bullet names: the item announced as actionable,
 * a screen-reader user activated it, and nothing happened.
 *
 * These assert the outcome a user gets from the composed component —
 * `RowActions` → `MenuItem` → the real `<button>` — rather than that a
 * prop was handed down. `Menu.test.tsx` pins the primitive; this pins
 * that the settings panels' action list actually reaches it.
 */
function open(actions: Parameters<typeof RowActions>[0]["actions"]) {
  render(<RowActions label='Actions for project "Tasks"' actions={actions} />);
  fireEvent.click(screen.getByRole("button", { name: 'Actions for project "Tasks"' }));
}

describe("RowActions disabled actions", () => {
  const withDisabledDelete = (onSelect = vi.fn()) => {
    open([
      { label: "Edit…", testId: "project-edit-x", onSelect: () => undefined },
      {
        label: "Delete",
        testId: "project-delete-x",
        danger: true,
        disabled: true,
        title: "A tracker must have at least one project. Create the replacement first.",
        onSelect,
      },
    ]);
    return onSelect;
  };

  it("renders the unavailable action as a really-disabled control", () => {
    withDisabledDelete();
    expect(screen.getByTestId("project-delete-x")).toHaveProperty("disabled", true);
  });

  it("refuses focus, so it is not an actionable stop for a keyboard user", () => {
    withDisabledDelete();
    const del = screen.getByTestId("project-delete-x");
    del.focus();
    expect(document.activeElement).not.toBe(del);
  });

  it("puts the reason on the button, not on an inner span", () => {
    withDisabledDelete();
    const del = screen.getByTestId("project-delete-x");
    expect(del.getAttribute("title")).toMatch(/at least one project/i);
    // The reason is the BUTTON's — nothing inside it carries a competing
    // `title`, which is where it used to live and where assistive tech
    // never read it as the control's description.
    expect(del.querySelector("[title]")).toBeNull();
  });

  it("does nothing when activated", () => {
    const onSelect = withDisabledDelete();
    fireEvent.click(screen.getByTestId("project-delete-x"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still runs an action that is NOT disabled", () => {
    // The negative control: the disabling must be targeted, not a menu
    // that stopped working. Mirrors PRU-26's "others are not" half.
    const live = vi.fn();
    open([
      { label: "Edit…", testId: "user-edit-x", onSelect: live },
      { label: "Archive", testId: "user-archive-x", disabled: true, title: "Switch users first.", onSelect: () => undefined },
    ]);
    const edit = screen.getByTestId("user-edit-x");
    expect(edit).toHaveProperty("disabled", false);
    edit.focus();
    expect(document.activeElement).toBe(edit);
    fireEvent.click(edit);
    expect(live).toHaveBeenCalledTimes(1);
  });
});
