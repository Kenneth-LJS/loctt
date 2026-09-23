// @vitest-environment jsdom
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu, MenuItem } from "./Menu.tsx";

// Computes the real accessible name/description rather than reading an
// attribute — which is what the disabled-reason assertions below need,
// since UI-23e changed WHICH attribute produces the description.
expect.extend(matchers);

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
 * A disabled MenuItem is genuinely disabled (A11Y-31).
 *
 * The third bullet: "a control that is inert but announces as
 * actionable is a defect". The previous spelling dropped `onSelect` and
 * added `opacity-50`, which left a button with no `disabled` property,
 * no `aria-disabled`, still in the focus order, and its reason on an
 * inner `<span>` where it is a pointer tooltip rather than the button's
 * accessible description.
 *
 * Each test below asserts what the USER gets — the focus order, the
 * described-by text, whether activation does anything — not merely that
 * a prop was forwarded.
 */
describe("MenuItem disabled", () => {
  function renderWithDisabled(onSelect = vi.fn()) {
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => (
          <>
            <MenuItem>Edit</MenuItem>
            <MenuItem
              disabled
              title="A tracker must have at least one project."
              onSelect={onSelect}
            >
              Delete
            </MenuItem>
            <MenuItem>Duplicate</MenuItem>
          </>
        )}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    return { onSelect };
  }

  it("exposes the disabled state to assistive tech rather than only dimming", () => {
    renderWithDisabled();
    const del = screen.getByRole("menuitem", { name: /Delete/ });
    // The native property, not an aria attribute painted on — this is
    // what carries the implicit `aria-disabled` to the a11y tree.
    expect(del).toHaveProperty("disabled", true);
  });

  it("refuses focus, so it never announces as an actionable stop", () => {
    renderWithDisabled();
    const del = screen.getByRole("menuitem", { name: /Delete/ });
    del.focus();
    expect(document.activeElement).not.toBe(del);
  });

  it("carries its reason as the BUTTON's accessible description", () => {
    renderWithDisabled();
    const del = screen.getByRole("menuitem", { name: /Delete/ });
    // The COMPUTED description, not an attribute. UI-23e migrated this
    // from `title` (which browsers expose as the description only as a
    // fallback) to an explicit `aria-describedby` → `sr-only` node. This
    // assertion is deliberately mechanism-agnostic: it passed before the
    // migration and after, because what must survive is the description
    // reaching assistive tech, not the attribute that produced it.
    expect(del).toHaveAccessibleDescription(/at least one project/i);
  });

  it("keeps the reason OUT of the name, so the item is still called 'Delete'", () => {
    renderWithDisabled();
    const del = screen.getByRole("menuitem", { name: /Delete/ });
    // The regression this guards: wiring the reason as `aria-label`, or
    // putting the sr-only node INSIDE the button, would make the item
    // announce the reason instead of / appended to its name. Name and
    // description are different jobs and both must survive.
    expect(del).toHaveAccessibleName("Delete");
  });

  it("is skipped by arrow-key roving so the keyboard cursor never lands on it", () => {
    renderWithDisabled();
    const menu = screen.getByRole("menu");
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    const dup = screen.getByRole("menuitem", { name: "Duplicate" });
    edit.focus();
    // ArrowDown from the first ENABLED item skips the disabled one
    // entirely and lands on the next enabled item.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(dup);
  });

  it("does not run its action when activated", () => {
    const { onSelect } = renderWithDisabled();
    const del = screen.getByRole("menuitem", { name: /Delete/ });
    fireEvent.click(del);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("an item left enabled is unaffected: focusable, described by nothing, and it fires", () => {
    // The negative control. Without this, every assertion above would
    // also pass against a MenuItem that disabled *everything*.
    const onSelect = vi.fn();
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => <MenuItem onSelect={onSelect}>Edit</MenuItem>}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    expect(edit).toHaveProperty("disabled", false);
    // Described by nothing: no reason was given, so no description node
    // and no dangling `aria-describedby` reference.
    expect(edit.getAttribute("aria-describedby")).toBeNull();
    expect(edit).not.toHaveAccessibleDescription();
    edit.focus();
    expect(document.activeElement).toBe(edit);
    fireEvent.click(edit);
    expect(onSelect).toHaveBeenCalledTimes(1);
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

  // Portalled means an owner cannot use `contains(relatedTarget)` to see
  // focus moving into its own menu. The editors' leave-on-blur guards
  // ask for this marker instead; without it, picking Bold from the
  // toolbar's folded Text style menu exited the description's edit mode
  // (UI-23d). `Dropdown` carries the same one.
  it("marks the portalled panel so an owner can recognise its own menu", () => {
    const menu = renderOpen();
    expect(menu.closest("[data-portal-panel]")).not.toBeNull();
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
        {() => <MenuItem>Delete</MenuItem>}
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
        {() => <MenuItem>Delete</MenuItem>}
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
            <MenuItem onSelect={() => { onSelect(); close(); }}>Delete</MenuItem>
          )}
        </Menu>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const item = screen.getByRole("menuitem", { name: "Delete" });

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
/**
 * Focus restore on close (known-gaps: "`ui/Menu` never restores focus on
 * close"). Escape and outside-click return focus to the trigger;
 * selecting an item does not (it may be navigating away, see Menu.tsx's
 * docstring); a trigger that has unmounted by close time (A11Y-15) is
 * skipped rather than throwing or focusing a detached node.
 */
describe("Menu focus restore", () => {
  it("Escape returns focus to the trigger", () => {
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
    trigger.focus();
    fireEvent.click(trigger);
    // The panel's own open-focus effect runs on a rAF the test does not
    // flush; move focus into the panel directly (as a keyboard user
    // tabbing/arrowing into it would end up) so the close path has
    // somewhere other than the trigger to restore FROM.
    screen.getByRole("menuitem").focus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("an outside click returns focus to the trigger", () => {
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
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    screen.getByRole("menuitem").focus();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(document.activeElement).toBe(trigger);
  });

  it("selecting an item does not fight the destination for focus", () => {
    // The item's own onSelect moves focus (standing in for a Link
    // navigating away, or a dialog opening). Restoring to the trigger
    // here would immediately steal focus back from that destination.
    render(
      <div>
        <input type="text" aria-label="destination" />
        <Menu
          aria-label="Actions"
          trigger={({ toggle, ...rest }) => (
            <button type="button" onClick={toggle} {...rest}>Open</button>
          )}
        >
          {({ close }) => (
            <MenuItem
              onSelect={() => {
                screen.getByLabelText("destination").focus();
                close();
              }}
            >
              Go
            </MenuItem>
          )}
        </Menu>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Go" }));

    expect(document.activeElement).toBe(screen.getByLabelText("destination"));
  });

  it("does not throw and does not focus a detached node when the trigger's own DOM node has been replaced", () => {
    // A11Y-15's shape for Menu: the captured trigger node can go stale
    // without the Menu instance itself unmounting — e.g. a list re-render
    // swaps in a new button for the same logical row (a key change, a
    // conditional icon/label edit) while the menu is still open. The old
    // node is then detached even though `Menu` and its `trigger` render
    // prop are still mounted and still listening for Escape.
    //
    // A variant that unmounts the whole `<Menu>` cannot exercise this:
    // Menu's own close-effect cleanup removes its Escape listener at the
    // same time, so `restoreFocus` would never run either way and the
    // test would pass with or without the `isConnected` guard — a false
    // green. Swapping only the trigger's key keeps `Menu` mounted and
    // listening, so the guard is the only thing standing between this and
    // a stale-node `.focus()` call.
    function Harness({ triggerKey }: { readonly triggerKey: string }) {
      return (
        <Menu
          aria-label="Actions"
          trigger={({ toggle, ...rest }) => (
            <button key={triggerKey} type="button" onClick={toggle} {...rest}>Open</button>
          )}
        >
          {() => <MenuItem>Alpha</MenuItem>}
        </Menu>
      );
    }
    const { rerender } = render(<Harness triggerKey="a" />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    screen.getByRole("menuitem").focus();

    // The real regression signal: `.focus()` must never even be attempted
    // on the now-detached old trigger node. jsdom quietly no-ops a
    // `.focus()` call on a disconnected element (activeElement can't
    // become it either way), so asserting `document.activeElement` alone
    // would pass even with the `isConnected` guard deleted — this spy is
    // what actually goes red for that regression.
    const focusSpy = vi.spyOn(trigger, "focus");

    // React remounts a fresh <button> for the trigger; the menu itself
    // (and its listeners) stays mounted and open throughout.
    rerender(<Harness triggerKey="b" />);
    expect(trigger.isConnected).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeNull();

    expect(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    }).not.toThrow();
    expect(focusSpy).not.toHaveBeenCalled();
  });
});

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

describe("MenuItem checked", () => {
  // A toggle row must announce its state, as the flat toolbar button's
  // `aria-pressed` does (TSK-72); an action row has no state to announce.
  it("is a menuitemcheckbox carrying aria-checked only when `checked` is given", () => {
    render(
      <Menu
        aria-label="Actions"
        trigger={({ toggle, ...rest }) => (
          <button type="button" onClick={toggle} {...rest}>Open</button>
        )}
      >
        {() => (
          <>
            <MenuItem checked>On</MenuItem>
            <MenuItem checked={false}>Off</MenuItem>
            <MenuItem>Action</MenuItem>
          </>
        )}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "On" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Off" })).toHaveAttribute("aria-checked", "false");
    const action = screen.getByRole("menuitem", { name: "Action" });
    expect(action).not.toHaveAttribute("aria-checked");
  });
});
