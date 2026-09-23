// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dropdown,
  DROPDOWN_SEARCH_THRESHOLD,
  DropdownButton,
  type DropdownOption,
  filterOptions,
} from "./Dropdown.tsx";

/**
 * The searchable value picker (A211). These tests pin the behaviour every
 * migrated site relies on: when the search box appears (the threshold
 * rule), that it filters, that the current value is marked rather than
 * filtered out, the keyboard model, server-side search (K90), and the
 * multi-select variant. What regression each would catch is in its name.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const opts = (n: number): DropdownOption[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${String(i)}`,
    label: `Option ${String(i).padStart(2, "0")}`,
  }));

function renderSingle(props: {
  options: readonly DropdownOption[];
  value?: string | undefined;
  search?: { onQuery: (q: string) => Promise<readonly DropdownOption[]> } | undefined;
  searchable?: boolean | undefined;
  onSubmitQuery?: ((q: string) => void) | undefined;
}) {
  const onSelect = vi.fn();
  render(
    <Dropdown
      label="Thing"
      options={props.options}
      value={props.value}
      onSelect={onSelect}
      search={props.search}
      searchable={props.searchable}
      onSubmitQuery={props.onSubmitQuery}
      listTestId="list"
      searchTestId="search"
      trigger={p => <DropdownButton {...p} testId="trigger" aria-label="Thing">{props.value}</DropdownButton>}
    />,
  );
  return { onSelect };
}

const optionNames = (): string[] =>
  within(screen.getByTestId("list")).queryAllByRole("option").map(o => o.textContent ?? "");

describe("filterOptions", () => {
  it("matches case-insensitively on label, hint and suffix; blank matches all", () => {
    const rows = [
      { label: "Ada", hint: "u-123" },
      { label: "Grace", suffix: "(archived)" },
    ];
    expect(filterOptions(rows, "")).toHaveLength(2);
    expect(filterOptions(rows, "ADA").map(r => r.label)).toEqual(["Ada"]);
    expect(filterOptions(rows, "123").map(r => r.label)).toEqual(["Ada"]);
    expect(filterOptions(rows, "archived").map(r => r.label)).toEqual(["Grace"]);
  });
});

describe("Dropdown — search box rule (A211)", () => {
  it("stays a plain list under the threshold", () => {
    renderSingle({ options: opts(DROPDOWN_SEARCH_THRESHOLD - 1) });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("search")).toBeNull();
    expect(optionNames()).toHaveLength(DROPDOWN_SEARCH_THRESHOLD - 1);
  });

  it("grows a search box at the threshold, filters as typed, and never filters out the current value", () => {
    renderSingle({ options: opts(DROPDOWN_SEARCH_THRESHOLD), value: "k3" });
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");
    expect(search.getAttribute("role")).toBe("combobox");
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "option 07" } });
    // The match, plus the current value pinned first and still marked.
    expect(optionNames()).toEqual(["Option 03", "Option 07"]);
    const current = within(screen.getByTestId("list")).getByRole("option", { name: "Option 03" });
    expect(current.getAttribute("aria-selected")).toBe("true");
  });

  it("`searchable` overrides the threshold in both directions", () => {
    renderSingle({ options: opts(3), searchable: true });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("search")).toBeTruthy();
    cleanup();
    renderSingle({ options: opts(30), searchable: false });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("search")).toBeNull();
  });
});

describe("Dropdown — keyboard", () => {
  it("ArrowDown moves the active option, Enter picks it, and the list closes with focus on the trigger", () => {
    const { onSelect } = renderSingle({ options: opts(20) });
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");

    // The first enabled option is active by default (Enter picks the top
    // match after typing), ArrowDown advances.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const active = search.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? "")?.textContent).toBe("Option 02");

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("k2");
    expect(screen.queryByTestId("list")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("trigger"));
  });

  it("Escape closes without a write and returns focus to the trigger (TSK-41)", () => {
    const { onSelect } = renderSingle({ options: opts(20) });
    fireEvent.click(screen.getByTestId("trigger"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("list")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId("trigger"));
  });

  it("Enter with nothing to pick calls onSubmitQuery with the typed text", () => {
    const onSubmitQuery = vi.fn();
    const { onSelect } = renderSingle({ options: opts(20), onSubmitQuery });
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");
    fireEvent.change(search, { target: { value: "  nothing matches  " } });
    expect(optionNames()).toEqual([]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSubmitQuery).toHaveBeenCalledWith("nothing matches", expect.any(Function));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ArrowDown on the trigger opens a plain (no-search) list", () => {
    renderSingle({ options: opts(3) });
    fireEvent.keyDown(screen.getByTestId("trigger"), { key: "ArrowDown" });
    expect(screen.getByTestId("list")).toBeTruthy();
  });
});

describe("Dropdown — server-side search (K90)", () => {
  it("debounces the query, shows Loading… meanwhile BELOW the already-selected value, and renders the answer", async () => {
    vi.useFakeTimers();
    const onQuery = vi.fn((q: string): Promise<readonly DropdownOption[]> =>
      Promise.resolve(q === "" ? opts(2) : [{ key: "hit", label: `Hit for ${q}` }]));
    renderSingle({
      options: [{ key: "cur", label: "Current one" }],
      value: "cur",
      search: { onQuery },
    });
    fireEvent.click(screen.getByTestId("trigger"));
    // Always searchable in server mode, however short `options` is.
    const search = screen.getByTestId("search");
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(onQuery).not.toHaveBeenCalled();
    // The selected option is not just present but reads FIRST — the
    // pending row must come after it in the list, not before, so the
    // value the user already picked is not buried under "Loading…".
    expect(optionNames()).toEqual(["Current one"]);
    const listChildren = Array.from(screen.getByTestId("list").children);
    const currentIndex = listChildren.findIndex(el => el.textContent === "Current one");
    const loadingIndex = listChildren.findIndex(el => el.textContent === "Loading…");
    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(loadingIndex).toBeGreaterThan(currentIndex);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(onQuery).toHaveBeenCalledWith("");
    expect(optionNames()).toEqual(["Current one", "Option 00", "Option 01"]);

    fireEvent.change(search, { target: { value: "x" } });
    // Typing within the debounce window sends one query, not one per key.
    fireEvent.change(search, { target: { value: "xy" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith("xy");
    expect(optionNames()).toEqual(["Current one", "Hit for xy"]);
  });
});

describe("Dropdown — multi", () => {
  function renderMulti(selected: readonly string[], hideSelected = false) {
    const onToggle = vi.fn();
    render(
      <Dropdown
        mode="multi"
        label="Things"
        options={opts(4)}
        selected={selected}
        onToggle={onToggle}
        hideSelected={hideSelected}
        listTestId="list"
        trigger={p => <DropdownButton {...p} testId="trigger" aria-label="Things" />}
      />,
    );
    return { onToggle };
  }

  it("reports on/off per pick and stays open for the next one", () => {
    const { onToggle } = renderMulti(["k1"]);
    fireEvent.click(screen.getByTestId("trigger"));
    const list = screen.getByTestId("list");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(within(list).getByRole("option", { name: "Option 01" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(within(list).getByRole("option", { name: "Option 02" }));
    expect(onToggle).toHaveBeenCalledWith("k2", true);
    fireEvent.click(within(list).getByRole("option", { name: "Option 01" }));
    expect(onToggle).toHaveBeenCalledWith("k1", false);
    expect(screen.getByTestId("list")).toBeTruthy();
  });

  it("hideSelected drops picked options from the list (the labels picker)", () => {
    renderMulti(["k1", "k3"], true);
    fireEvent.click(screen.getByTestId("trigger"));
    expect(optionNames()).toEqual(["Option 00", "Option 02"]);
  });
});

describe("Dropdown — disabled options", () => {
  it("shows a disabled option with its reason, does not pick it, and skips it in keyboard travel", () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        label="Milestone"
        options={[
          { key: "a", label: "Alpha", disabled: true, suffix: "(archived)" },
          { key: "b", label: "Beta" },
        ]}
        searchable
        value={undefined}
        onSelect={onSelect}
        disabledReason="Archived milestones cannot be newly assigned."
        listTestId="list"
        searchTestId="search"
        trigger={p => <DropdownButton {...p} testId="trigger" aria-label="Milestone" />}
      />,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    const alpha = within(screen.getByTestId("list")).getByRole("option", { name: /Alpha/ });
    expect((alpha as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Archived milestones cannot be newly assigned.")).toBeTruthy();
    fireEvent.click(alpha);
    expect(onSelect).not.toHaveBeenCalled();

    // Active starts on the first ENABLED option, so Enter picks Beta.
    fireEvent.keyDown(screen.getByTestId("search"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("DropdownButton — aria-labelledby (A211/A242)", () => {
  // ReconcilePanel's pick-value control is named by a separate heading
  // <div>, not a string label. The trigger must take that heading's id via
  // aria-labelledby and expose it as its accessible name, so a swap from a
  // native <select aria-labelledby> keeps the association — otherwise
  // getByRole("button", { name: "Status" }) finds nothing.
  it("names the trigger via aria-labelledby when supplied", () => {
    render(
      <>
        <div id="field-name">Status</div>
        <Dropdown
          label="Status"
          options={[{ key: "a", label: "A" }]}
          value={undefined}
          onSelect={() => {}}
          listTestId="list"
          trigger={p => (
            <DropdownButton {...p} testId="trigger" aria-labelledby="field-name" />
          )}
        />
      </>,
    );
    // The accessible name comes from the referenced element.
    const trigger = screen.getByRole("button", { name: "Status" });
    expect(trigger.getAttribute("data-testid")).toBe("trigger");
    expect(trigger.getAttribute("aria-labelledby")).toBe("field-name");
    // aria-labelledby wins over aria-label — no duplicated name.
    expect(trigger.getAttribute("aria-label")).toBeNull();
  });

  it("falls back to aria-label when no aria-labelledby is given", () => {
    render(
      <Dropdown
        label="Zone"
        options={[{ key: "a", label: "A" }]}
        value={undefined}
        onSelect={() => {}}
        listTestId="list"
        trigger={p => <DropdownButton {...p} testId="trigger" aria-label="Zone" />}
      />,
    );
    expect(screen.getByRole("button", { name: "Zone" }).getAttribute("aria-label")).toBe("Zone");
  });
});

/**
 * ── Menu mode (K106 stage 2) ─────────────────────────────────────────
 *
 * These are `list/FilterFacet`'s behavioural contracts, ported onto
 * the merged primitive when that component was folded in. They are not
 * new requirements: checkbox toggling, roving focus (A11Y-10),
 * type-ahead and outside-click dismissal are what the filter facets
 * shipped, and roughly thirty `tests/ui/` assertions read the
 * `menuitemcheckbox` role directly. If the merge had quietly adopted the
 * listbox role set, every one of them would have gone red in the e2e
 * suite instead of here.
 */
describe("Dropdown — menu mode semantics", () => {
  function renderMenu(opts: {
    selected?: readonly string[];
    options?: readonly DropdownOption[];
    onRemove?: boolean;
  } = {}) {
    const onToggle = vi.fn();
    render(
      <Dropdown
        mode="menu"
        label="Status"
        options={opts.options ?? [
          { key: "todo", label: "To do" },
          { key: "doing", label: "In progress" },
          { key: "done", label: "Done" },
        ]}
        selected={opts.selected ?? []}
        onToggle={onToggle}
        listTestId="list"
        searchTestId="search"
        {...(opts.onRemove === true
          ? {
              footer: () => (
                <button type="button" role="menuitem" data-testid="remove">
                  Remove this filter
                </button>
              ),
            }
          : {})}
        trigger={({ ref, toggle, ...aria }) => (
          <button ref={ref} type="button" data-testid="trigger" onClick={toggle} {...aria}>
            Status
          </button>
        )}
      />,
    );
    return { onToggle };
  }

  it("renders menuitemcheckbox rows in a role=menu panel, NOT listbox options", () => {
    renderMenu({ selected: ["doing"] });
    fireEvent.click(screen.getByTestId("trigger"));

    // The container is a menu, not a listbox: `menuitemcheckbox` is only
    // valid inside `role="menu"`, and an intervening listbox would orphan
    // the rows.
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();

    // Assert the ACCESSIBLE names, not `textContent`: the checkbox mirror
    // renders a "✓" glyph which `aria-hidden` keeps off the a11y tree but
    // not out of raw text. The accessible name is what both a screen
    // reader and every `getByRole(…, { name })` in `tests/ui/` read.
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows).toHaveLength(3);
    for (const name of ["To do", "In progress", "Done"]) {
      expect(screen.getByRole("menuitemcheckbox", { name })).toBeTruthy();
    }
    // Checked-ness is spelled `aria-checked` here, not `aria-selected` —
    // that is what the role demands and what the e2e suite reads.
    expect(screen.getByRole("menuitemcheckbox", { name: "In progress" })
      .getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Done" })
      .getAttribute("aria-checked")).toBe("false");
    // And the trigger announces the right kind of popup.
    expect(screen.getByTestId("trigger").getAttribute("aria-haspopup")).toBe("menu");
  });

  it("toggles a row on and off and stays open for the next pick", () => {
    const { onToggle } = renderMenu({ selected: ["doing"] });
    fireEvent.click(screen.getByTestId("trigger"));

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Done" }));
    expect(onToggle).toHaveBeenCalledWith("done", true);
    // Unchecking an already-selected row reports `false`.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "In progress" }));
    expect(onToggle).toHaveBeenCalledWith("doing", false);
    // Multi-select: the panel does not close after a pick.
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("A11Y-10: the first row takes REAL DOM focus on open and arrows rove it", async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("trigger"));
    const rows = screen.getAllByRole("menuitemcheckbox");

    // Focus is deferred to after the panel paints its children.
    await act(async () => {
      await new Promise(r => { requestAnimationFrame(() => { r(null); }); });
    });
    // Real focus, not an aria-activedescendant pointer: this is the
    // promise `role="menu"` makes and the listbox model does not keep.
    expect(document.activeElement).toBe(rows[0]);

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);
    // Wraps.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[2]);
    // Home/End jump.
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(rows[2]);
  });

  it("type-ahead jumps to the next row starting with the typed character", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("trigger"));
    const rows = screen.getAllByRole("menuitemcheckbox");
    rows[0]?.focus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "d" });
    expect(document.activeElement).toBe(rows[2]); // "Done"
  });

  it("roving focus reaches the trailing menuitem row (Remove this filter), not just the checkboxes", () => {
    renderMenu({ onRemove: true });
    fireEvent.click(screen.getByTestId("trigger"));
    const menu = screen.getByRole("menu");
    screen.getAllByRole("menuitemcheckbox")[2]?.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    // Arrow travel covers the whole panel, exactly as `ui/Menu` did —
    // a selector restricted to `menuitemcheckbox` would skip this row
    // and the remove control would be arrow-unreachable.
    expect(document.activeElement).toBe(screen.getByTestId("remove"));
  });

  it("a click outside the portalled panel closes it, a click inside does not", () => {
    const { onToggle } = renderMenu();
    render(<button type="button" data-testid="outside">Elsewhere</button>);
    fireEvent.click(screen.getByTestId("trigger"));

    // The panel is portalled to body, so the outside-click guard has to
    // check the panel ref too — otherwise the mousedown preceding every
    // row click would close the panel before the click landed.
    const row = screen.getByRole("menuitemcheckbox", { name: "Done" });
    fireEvent.mouseDown(row);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith("done", true);

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("grows a search box at the shared threshold and filters the rows", () => {
    renderMenu({
      options: Array.from({ length: DROPDOWN_SEARCH_THRESHOLD }, (_, i) => ({
        key: `k${String(i)}`,
        label: `Option ${String(i).padStart(2, "0")}`,
      })),
    });
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");
    fireEvent.change(search, { target: { value: "option 07" } });
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows).toHaveLength(1);
    expect(screen.getByRole("menuitemcheckbox", { name: "Option 07" })).toBeTruthy();
  });

  it("while focus is in the search box the menu key model stands down", () => {
    renderMenu({
      options: Array.from({ length: DROPDOWN_SEARCH_THRESHOLD }, (_, i) => ({
        key: `k${String(i)}`,
        label: `Item ${String(i).padStart(2, "0")}`,
      })),
    });
    fireEvent.click(screen.getByTestId("trigger"));
    const search = screen.getByTestId("search");
    search.focus();
    // Typing "i" must reach the input, not roving-focus the "Item 00"
    // row — otherwise the search box cannot be typed into at all.
    fireEvent.keyDown(search, { key: "i" });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(search);
  });

  it("distinguishes a failed option load from an empty one (F4/ERR-1)", () => {
    render(
      <Dropdown
        mode="menu"
        label="Labels"
        options={[]}
        selected={[]}
        onToggle={() => {}}
        noMatchesText="Labels options could not be loaded — see the sidebar for why."
        trigger={({ ref, toggle, ...aria }) => (
          <button ref={ref} type="button" data-testid="trigger" onClick={toggle} {...aria}>
            Labels
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    // A broken config must not read as "No options" — an absence and a
    // failure must not look alike.
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});

/**
 * ── Portalling (MENU-PORTAL, the whole point of K106 stage 2) ────────
 *
 * `Combobox` rendered an inline `absolute` panel, which is clipped by any
 * ancestor with `overflow` — the defect that sliced the sidebar kebab
 * menu in half. The merged `Dropdown` portals to `document.body` in every
 * mode, so no ancestor is in a position to clip it.
 */
describe("Dropdown — portalled panel escapes ancestor overflow", () => {
  /**
   * The direct proof: render the dropdown inside a scroll container and
   * assert the panel is not a descendant of it. An inline `absolute`
   * panel IS a descendant, and is therefore clipped by the container's
   * `overflow: hidden` — which is exactly the bug, and is invisible to
   * every other assertion in this file.
   */
  const assertEscapes = (panel: HTMLElement, clipper: HTMLElement): void => {
    expect(clipper.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    // And it is positioned in viewport coordinates, which is the other
    // half of the fix: only `fixed` can be clamped to the viewport.
    expect(panel.className).toContain("fixed");
  };

  it("single mode: the listbox panel is not clipped by a scrolling ancestor", () => {
    render(
      <div data-testid="scroller" style={{ overflow: "hidden", height: 40 }}>
        <Dropdown
          label="Thing"
          options={[{ key: "a", label: "Alpha" }]}
          value={undefined}
          onSelect={() => {}}
          listTestId="list"
          trigger={p => <DropdownButton {...p} testId="trigger" aria-label="Thing" />}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    // The panel is the listbox's parent — the positioned element.
    const panel = screen.getByTestId("list").parentElement as HTMLElement;
    assertEscapes(panel, screen.getByTestId("scroller"));
  });

  it("menu mode: the facet panel is not clipped by a scrolling ancestor", () => {
    render(
      <div data-testid="scroller" style={{ overflow: "hidden", height: 40 }}>
        <Dropdown
          mode="menu"
          label="Status"
          options={[{ key: "a", label: "Alpha" }]}
          selected={[]}
          onToggle={() => {}}
          trigger={({ ref, toggle, ...aria }) => (
            <button ref={ref} type="button" data-testid="trigger" onClick={toggle} {...aria}>
              Status
            </button>
          )}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    assertEscapes(screen.getByRole("menu"), screen.getByTestId("scroller"));
  });

  it("clamps the panel inside the viewport instead of letting align=end run off the left", () => {
    // The sidebar-kebab geometry: a narrow viewport and a trigger flush
    // against its right edge. `align="end"` alone would put the panel's
    // left at 178 - 200 = -22, i.e. off-screen.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(180);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const PANEL_WIDTH = 200;
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
      <Dropdown
        mode="menu"
        align="end"
        label="Status"
        options={[{ key: "a", label: "Alpha" }]}
        selected={[]}
        onToggle={() => {}}
        trigger={({ ref, toggle, ...aria }) => (
          <button ref={ref} type="button" data-testid="trigger" onClick={toggle} {...aria}>
            Status
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    // Floored at the 8px gutter rather than left at -22.
    expect(parseFloat(screen.getByRole("menu").style.left)).toBe(8);
    vi.restoreAllMocks();
  });
});
