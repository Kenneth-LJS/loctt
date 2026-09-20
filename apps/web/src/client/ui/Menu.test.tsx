// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu, MenuItem } from "./Menu.tsx";

/**
 * Menu keyboard navigation (A11Y-9 / docs/dev/design/design-review.md §A2).
 *
 * A `role="menu"` promises roving arrow-key movement between items, not
 * just Tab. These assert the roving behavior directly; if the panel ever
 * drops back to plain buttons with no arrow handling, they go red.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

/**
 * Portalling + viewport-aware placement (MENU-PORTAL).
 *
 * The panel renders into `document.body` and is positioned with
 * measured coordinates so an ancestor's `overflow` cannot clip it and
 * it can be clamped inside the viewport. These assert both halves:
 * the panel escapes the wrapper's subtree, and it never crosses a
 * viewport edge.
 */
describe("Menu portalling and placement", () => {
  it("renders the panel under document.body, outside the trigger wrapper", () => {
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Alpha</MenuItem>}
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    // The wrapper is the trigger's parent `.relative.inline-flex` div.
    const wrapper = trigger.parentElement as HTMLElement;
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    // Portalled: the panel is NOT inside the wrapper...
    expect(wrapper.contains(menu)).toBe(false);
    // ...and it is a descendant of body.
    expect(document.body.contains(menu)).toBe(true);
  });

  /**
   * The sidebar-kebab bug: an `align="end"` trigger sitting near the
   * right edge of a narrow column would place a 200px panel off the
   * LEFT of the viewport. With `right`-aligning alone the panel's left
   * would be `triggerRight - panelWidth`; the clamp must keep it at or
   * past the left gutter.
   */
  it("clamps an align=end panel so it stays within the viewport near the right edge", () => {
    // A narrow viewport, and a trigger ~24px from its right edge.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(240);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);

    const TRIGGER_RIGHT = 216; // 240 - 24
    const PANEL_WIDTH = 200;
    const PANEL_HEIGHT = 120;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        if (this.getAttribute("role") === "menu") {
          return {
            left: 0, right: PANEL_WIDTH, top: 0, bottom: PANEL_HEIGHT,
            width: PANEL_WIDTH, height: PANEL_HEIGHT, x: 0, y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        // The trigger wrapper.
        return {
          left: TRIGGER_RIGHT - 28, right: TRIGGER_RIGHT, top: 100, bottom: 128,
          width: 28, height: 28, x: TRIGGER_RIGHT - 28, y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );

    render(
      <Menu
        align="end"
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Delete…</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const menu = screen.getByRole("menu");
    const left = parseFloat(menu.style.left);
    // align=end alone would give 216 - 200 = 16, which happens to be in
    // bounds here; the real regression is a panel that would go
    // negative. Assert the invariant directly for any placement: the
    // panel's whole width stays within [margin, innerWidth - margin].
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + PANEL_WIDTH).toBeLessThanOrEqual(240 - 8);
  });

  /**
   * Direct clamp math: a trigger flush against the right edge of a
   * viewport narrower than the panel forces `align=end`'s natural left
   * negative. The clamp must floor it at the left gutter.
   */
  it("floors the panel at the left gutter when align=end would push it off-screen", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(180);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);

    const PANEL_WIDTH = 200; // wider than the 180px viewport
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        if (this.getAttribute("role") === "menu") {
          return {
            left: 0, right: PANEL_WIDTH, top: 0, bottom: 100,
            width: PANEL_WIDTH, height: 100, x: 0, y: 0, toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          left: 150, right: 178, top: 50, bottom: 78,
          width: 28, height: 28, x: 150, y: 50, toJSON: () => ({}),
        } as DOMRect;
      },
    );

    render(
      <Menu
        align="end"
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Delete…</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const menu = screen.getByRole("menu");
    // Natural align=end left = 178 - 200 = -22 → clamped to the 8px gutter.
    expect(parseFloat(menu.style.left)).toBe(8);
  });
});

/**
 * Outside-click / inside-click dismissal after portalling (MENU-PORTAL).
 *
 * Because the panel is portalled it is no longer inside the trigger
 * wrapper, so the outside-click guard has to check the panel ref too —
 * otherwise clicking a menu item closes the menu before the item's own
 * onSelect fires. These pin both directions.
 */
describe("Menu dismissal", () => {
  it("a click inside the portalled panel does not close it before onSelect runs", () => {
    const onSelect = vi.fn();
    render(
      <div>
        <Menu
          aria-label="Actions"
          trigger={({ toggle, ...rest }) => (
            <button type="button" onClick={toggle} {...rest}>Open</button>
          )}
        >
          {({ close }) => (
            <MenuItem onSelect={() => { onSelect(); close(); }}>Delete…</MenuItem>
          )}
        </Menu>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const item = screen.getByRole("menuitem", { name: "Delete…" });

    // Simulate a real pointer press+click on the item: the document
    // mousedown listener fires first (it must NOT close the menu), then
    // the click reaches the item's handler.
    fireEvent.mouseDown(item);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a click outside both the trigger and the panel closes the menu", () => {
    render(
      <div>
        <button type="button" data-testid="outside">Elsewhere</button>
        <Menu
          aria-label="Actions"
          trigger={({ toggle, ...rest }) => (
            <button type="button" onClick={toggle} {...rest}>Open</button>
          )}
        >
          {() => <MenuItem>Alpha</MenuItem>}
        </Menu>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes the menu", () => {
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Alpha</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  /**
   * The menu's Escape handler calls `e.stopPropagation()` so an Escape
   * pressed inside a menu that was opened from a modal closes only the
   * menu, not the modal behind it. The plain "Escape closes the menu"
   * test above still passes if that call is deleted — it fires Escape on
   * `document`, where propagation is moot. This asserts the stop directly:
   * a document-level keydown listener (standing in for the modal's own
   * Escape handler) must NOT receive an Escape dispatched from the panel.
   */
  it("Escape stops propagation past document so an outer keydown handler is spared", () => {
    // The menu's Escape handler is a `document` keydown listener that
    // calls `e.stopPropagation()`. In jsdom (as in the browser) that does
    // not stop sibling *document* listeners, but it DOES stop the event
    // reaching `window`. A `window` keydown spy therefore isolates the
    // stopPropagation call: the event still runs the menu's own document
    // handler (closing the menu) but never bubbles on to window.
    const winSpy = vi.fn();
    window.addEventListener("keydown", winSpy);
    try {
      render(
        <Menu
          aria-label="Actions"
          trigger={({ toggle, ...rest }) => (
            <button type="button" onClick={toggle} {...rest}>Open</button>
          )}
        >
          {() => <MenuItem>Alpha</MenuItem>}
        </Menu>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      const menu = screen.getByRole("menu");

      // Fire Escape ON the panel so the event bubbles up to document
      // (where the menu's handler runs) and would continue to window.
      fireEvent.keyDown(menu, { key: "Escape" });

      // The menu closed...
      expect(screen.queryByRole("menu")).toBeNull();
      // ...and the window-level listener never saw the Escape, because the
      // menu stopped it at document. Delete `e.stopPropagation()` in
      // Menu.tsx and this spy is called once — the test goes red.
      expect(winSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", winSpy);
    }
  });
});

/**
 * Flip-above placement (MENU-PORTAL, `place()` vertical branch).
 *
 * The panel normally opens below the trigger, but when the trigger sits
 * low in a short viewport with no room for the panel underneath, it flips
 * ABOVE. The existing placement tests all mock `innerHeight: 800`, so the
 * flip branch never ran. This drives it directly.
 */
describe("Menu flip-above placement", () => {
  it("places the panel above the trigger when there is no room below", () => {
    // A short viewport with the trigger near its bottom: 300px tall,
    // trigger bottom at 270, and a 120px panel — 270 + 4 + 120 = 394 is
    // well past 300 - 8, so below does not fit and the panel flips up.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(400);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(300);

    const TRIGGER_TOP = 242;
    const TRIGGER_BOTTOM = 270;
    const PANEL_HEIGHT = 120;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        if (this.getAttribute("role") === "menu") {
          return {
            left: 0, right: 200, top: 0, bottom: PANEL_HEIGHT,
            width: 200, height: PANEL_HEIGHT, x: 0, y: 0, toJSON: () => ({}),
          } as DOMRect;
        }
        // The trigger wrapper, low in the viewport.
        return {
          left: 20, right: 48, top: TRIGGER_TOP, bottom: TRIGGER_BOTTOM,
          width: 28, height: 28, x: 20, y: TRIGGER_TOP, toJSON: () => ({}),
        } as DOMRect;
      },
    );

    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Alpha</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const menu = screen.getByRole("menu");
    const top = parseFloat(menu.style.top);
    // Flipped above: the panel's top sits above the trigger's top, and
    // its bottom clears the trigger's top edge. Natural below-placement
    // would be TRIGGER_BOTTOM + 4 = 274; the flip yields
    // TRIGGER_TOP - 4 - PANEL_HEIGHT = 118.
    expect(top).toBeLessThan(TRIGGER_TOP);
    expect(top + PANEL_HEIGHT).toBeLessThanOrEqual(TRIGGER_TOP);
    expect(top).toBe(TRIGGER_TOP - 4 - PANEL_HEIGHT);
  });
});

/**
 * z-index layering (MENU-PORTAL). The portalled panel carries `z-[65]`
 * so a menu opened from inside a dialog shows above the modal layers
 * (Modal `z-50`, CreateTaskModal `z-[55]`). Asserting the literal token
 * pins the chosen stacking level — dropping it to `z-50` goes red.
 */
describe("Menu z-index", () => {
  it("gives the panel z-[65] so it sits above the modal layers", () => {
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem>Alpha</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("z-[65]");
  });
});
