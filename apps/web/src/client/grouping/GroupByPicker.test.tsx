// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGroupingCatalog } from "./catalog.ts";
import { GroupByPicker } from "./GroupByPicker.tsx";

/**
 * TML-58: the full group-by set — the eight builtins plus every
 * single-value enum custom field — is reachable through a searchable
 * picker once the list crosses the search threshold.
 *
 * `buildGroupingCatalog`'s eligibility rules (which fields are offered
 * at all) are covered by catalog.test.ts; this file covers the PICKER
 * surface: the search box appearing, and selecting a custom field
 * actually calling back with `field.<key>`.
 */

afterEach(cleanup);

function wf(custom_fields: unknown[]): WorkflowConfig {
  return { relationships: [], custom_fields } as unknown as WorkflowConfig;
}

/** Enough single-value enum custom fields to cross the 12-option threshold. */
function manyEnumFields(n: number) {
  return Array.from({ length: n }, (_v, i) => ({
    key: `f${String(i)}`,
    label: `Field ${String(i)}`,
    type: "enum",
    multi: false,
    searchable: false,
    values: [{ key: "a", label: "A" }],
  }));
}

describe("GroupByPicker", () => {
  // @verifies TML-58
  it("offers no search box when the catalog is short (8 builtins only)", () => {
    const catalog = buildGroupingCatalog(wf([]));
    render(
      <GroupByPicker
        catalog={catalog}
        value="none"
        onChange={() => {}}
        testIdBase="tl-grouping"
        aria-label="Group by"
      />,
    );
    fireEvent.click(screen.getByTestId("tl-grouping"));
    expect(screen.queryByTestId("tl-grouping-search")).toBeNull();
  });

  // @verifies TML-58
  it("shows a search box once the catalog crosses the search threshold", () => {
    const catalog = buildGroupingCatalog(wf(manyEnumFields(6)));
    // 8 builtins + 6 custom fields = 14, past DROPDOWN_SEARCH_THRESHOLD (12).
    expect(catalog.length).toBeGreaterThanOrEqual(12);
    render(
      <GroupByPicker
        catalog={catalog}
        value="none"
        onChange={() => {}}
        testIdBase="tl-grouping"
        aria-label="Group by"
      />,
    );
    fireEvent.click(screen.getByTestId("tl-grouping"));
    expect(screen.getByTestId("tl-grouping-search")).not.toBeNull();
  });

  // @verifies TML-58
  it("typing a custom field's label surfaces it and selecting it emits field.<key>", () => {
    const catalog = buildGroupingCatalog(wf(manyEnumFields(6)));
    const onChange = vi.fn();
    render(
      <GroupByPicker
        catalog={catalog}
        value="none"
        onChange={onChange}
        testIdBase="tl-grouping"
        aria-label="Group by"
      />,
    );
    fireEvent.click(screen.getByTestId("tl-grouping"));
    fireEvent.change(screen.getByTestId("tl-grouping-search"), { target: { value: "Field 3" } });
    const option = screen.getByTestId("tl-grouping-opt-field.f3");
    expect(option.textContent).toContain("Field 3");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("field.f3");
  });

  // @verifies TML-58
  it("a search for 'custom' surfaces the custom fields and not the builtins", () => {
    const catalog = buildGroupingCatalog(wf(manyEnumFields(6)));
    render(
      <GroupByPicker
        catalog={catalog}
        value="none"
        onChange={() => {}}
        testIdBase="tl-grouping"
        aria-label="Group by"
      />,
    );
    fireEvent.click(screen.getByTestId("tl-grouping"));
    fireEvent.change(screen.getByTestId("tl-grouping-search"), { target: { value: "custom" } });
    // Every remaining option is a custom field (carries the "Custom field" hint).
    const list = screen.getByTestId("tl-grouping-options");
    expect(list.textContent).toContain("Custom field");
    expect(list.textContent).not.toContain("Assignee");
    expect(list.textContent).not.toContain("Project");
  });
});
