// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchivedScopeControl } from "./ArchivedScopeControl.tsx";

afterEach(cleanup);

/**
 * The one shared tri-state archived-scope control (K107). These pin the
 * three options, the value/onChange contract, the testid, and the label
 * association a screen reader relies on — the properties every surface
 * (FilterBar + the settings panels) leans on.
 */
describe("ArchivedScopeControl", () => {
  it("offers exactly the three scopes in order", () => {
    render(<ArchivedScopeControl value="active" onChange={() => {}} />);
    const options = screen.getAllByRole<HTMLOptionElement>("option");
    expect(options.map(o => o.value)).toEqual(["active", "archived", "all"]);
    expect(options.map(o => o.textContent)).toEqual(["Active", "Archived", "All"]);
  });

  it("reflects the current value and reports the picked scope", () => {
    const onChange = vi.fn();
    render(<ArchivedScopeControl value="active" onChange={onChange} testId="scope" />);
    const select = screen.getByTestId<HTMLSelectElement>("scope");
    expect(select.value).toBe("active");
    fireEvent.change(select, { target: { value: "archived" } });
    expect(onChange).toHaveBeenCalledWith("archived");
  });

  it("appends per-scope counts to the option label when given", () => {
    render(<ArchivedScopeControl value="active" onChange={() => {}} counts={{ archived: 3 }} />);
    const options = screen.getAllByRole<HTMLOptionElement>("option");
    expect(options.map(o => o.textContent)).toEqual(["Active", "Archived (3)", "All"]);
  });

  it("associates a visible label with the select for a11y", () => {
    render(<ArchivedScopeControl value="all" onChange={() => {}} testId="scope" label="Show items" />);
    const select = screen.getByTestId<HTMLSelectElement>("scope");
    const label = screen.getByText("Show items");
    // htmlFor points at the select's id, so the label names the control.
    expect(label.getAttribute("for")).toBe(select.id);
    expect(select.getAttribute("aria-label")).toBe("Archived scope");
  });
});
