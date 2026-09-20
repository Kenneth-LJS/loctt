// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Combobox,
  COMBOBOX_SEARCH_THRESHOLD,
  ComboboxButton,
  type ComboboxOption,
  filterOptions,
} from "./Combobox.tsx";

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

const opts = (n: number): ComboboxOption[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${String(i)}`,
    label: `Option ${String(i).padStart(2, "0")}`,
  }));

function renderSingle(props: {
  options: readonly ComboboxOption[];
  value?: string | undefined;
  search?: { onQuery: (q: string) => Promise<readonly ComboboxOption[]> } | undefined;
  filterable?: boolean | undefined;
  onSubmitQuery?: ((q: string) => void) | undefined;
}) {
  const onSelect = vi.fn();
  render(
    <Combobox
      label="Thing"
      options={props.options}
      value={props.value}
      onSelect={onSelect}
      search={props.search}
      filterable={props.filterable}
      onSubmitQuery={props.onSubmitQuery}
      listTestId="list"
      searchTestId="search"
      trigger={p => <ComboboxButton {...p} testId="trigger" aria-label="Thing">{props.value}</ComboboxButton>}
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

describe("Combobox — search box rule (A211)", () => {
  it("stays a plain list under the threshold", () => {
    renderSingle({ options: opts(COMBOBOX_SEARCH_THRESHOLD - 1) });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("search")).toBeNull();
    expect(optionNames()).toHaveLength(COMBOBOX_SEARCH_THRESHOLD - 1);
  });

  it("grows a search box at the threshold, filters as typed, and never filters out the current value", () => {
    renderSingle({ options: opts(COMBOBOX_SEARCH_THRESHOLD), value: "k3" });
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

  it("`filterable` overrides the threshold in both directions", () => {
    renderSingle({ options: opts(3), filterable: true });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("search")).toBeTruthy();
    cleanup();
    renderSingle({ options: opts(30), filterable: false });
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("search")).toBeNull();
  });
});

describe("Combobox — keyboard", () => {
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

describe("Combobox — server-side search (K90)", () => {
  it("debounces the query, shows Searching… meanwhile, renders the answer, and keeps the current value in the list", async () => {
    vi.useFakeTimers();
    const onQuery = vi.fn((q: string): Promise<readonly ComboboxOption[]> =>
      Promise.resolve(q === "" ? opts(2) : [{ key: "hit", label: `Hit for ${q}` }]));
    renderSingle({
      options: [{ key: "cur", label: "Current one" }],
      value: "cur",
      search: { onQuery },
    });
    fireEvent.click(screen.getByTestId("trigger"));
    // Always searchable in server mode, however short `options` is.
    const search = screen.getByTestId("search");
    expect(screen.getByText("Searching…")).toBeTruthy();
    expect(onQuery).not.toHaveBeenCalled();

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

describe("Combobox — multi", () => {
  function renderMulti(selected: readonly string[], hideSelected = false) {
    const onToggle = vi.fn();
    render(
      <Combobox
        mode="multi"
        label="Things"
        options={opts(4)}
        selected={selected}
        onToggle={onToggle}
        hideSelected={hideSelected}
        listTestId="list"
        trigger={p => <ComboboxButton {...p} testId="trigger" aria-label="Things" />}
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

describe("Combobox — disabled options", () => {
  it("shows a disabled option with its reason, does not pick it, and skips it in keyboard travel", () => {
    const onSelect = vi.fn();
    render(
      <Combobox
        label="Milestone"
        options={[
          { key: "a", label: "Alpha", disabled: true, suffix: "(archived)" },
          { key: "b", label: "Beta" },
        ]}
        filterable
        value={undefined}
        onSelect={onSelect}
        disabledReason="Archived milestones cannot be newly assigned."
        listTestId="list"
        searchTestId="search"
        trigger={p => <ComboboxButton {...p} testId="trigger" aria-label="Milestone" />}
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

describe("ComboboxButton — aria-labelledby (A211/A242)", () => {
  // ReconcilePanel's pick-value control is named by a separate heading
  // <div>, not a string label. The trigger must take that heading's id via
  // aria-labelledby and expose it as its accessible name, so a swap from a
  // native <select aria-labelledby> keeps the association — otherwise
  // getByRole("button", { name: "Status" }) finds nothing.
  it("names the trigger via aria-labelledby when supplied", () => {
    render(
      <>
        <div id="field-name">Status</div>
        <Combobox
          label="Status"
          options={[{ key: "a", label: "A" }]}
          value={undefined}
          onSelect={() => {}}
          listTestId="list"
          trigger={p => (
            <ComboboxButton {...p} testId="trigger" aria-labelledby="field-name" />
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
      <Combobox
        label="Zone"
        options={[{ key: "a", label: "A" }]}
        value={undefined}
        onSelect={() => {}}
        listTestId="list"
        trigger={p => <ComboboxButton {...p} testId="trigger" aria-label="Zone" />}
      />,
    );
    expect(screen.getByRole("button", { name: "Zone" }).getAttribute("aria-label")).toBe("Zone");
  });
});
