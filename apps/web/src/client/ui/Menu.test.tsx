// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Menu, MenuItem } from "./Menu.tsx";

/**
 * Menu keyboard navigation (A11Y-9 / design-review §A2).
 *
 * A `role="menu"` promises roving arrow-key movement between items, not
 * just Tab. These assert the roving behavior directly; if the panel ever
 * drops back to plain buttons with no arrow handling, they go red.
 */
afterEach(cleanup);

/** Render with a real trigger and open it. */
function renderOpen() {
  render(
    <Menu
      aria-label="Actions"
      trigger={({ toggle, ...rest }) => (
        <button type="button" onClick={toggle} {...rest}>Open</button>
      )}
    >
      {() => (
        <>
          <MenuItem>Alpha</MenuItem>
          <MenuItem>Beta</MenuItem>
          <MenuItem>Gamma</MenuItem>
        </>
      )}
    </Menu>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  return screen.getByRole("menu");
}

describe("Menu keyboard navigation", () => {
  it("ArrowDown moves focus to the next item and wraps", () => {
    const menu = renderOpen();
    const items = screen.getAllByRole("menuitem");
    items[0]?.focus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
    // wraps to first
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowUp moves to the previous item and wraps", () => {
    const menu = renderOpen();
    const items = screen.getAllByRole("menuitem");
    items[0]?.focus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("Home and End jump to the first and last item", () => {
    const menu = renderOpen();
    const items = screen.getAllByRole("menuitem");
    items[1]?.focus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("type-ahead jumps to the next item starting with the typed key", () => {
    const menu = renderOpen();
    const items = screen.getAllByRole("menuitem");
    items[0]?.focus();
    fireEvent.keyDown(menu, { key: "g" });
    expect(document.activeElement).toBe(items[2]); // Gamma
  });
});
