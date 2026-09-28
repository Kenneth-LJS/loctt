// @vitest-environment jsdom
/**
 * K150 / B45: a choice field that allows new values offers "Create “x”"
 * in its picker, as the labels picker does; a closed one never does.
 *
 * @verifies TSK-C15
 */
import type { CustomFieldDef } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { customFieldRows } from "./CustomFields.tsx";

const AREA: CustomFieldDef = {
  key: "area", label: "Area", type: "enum", multi: false, searchable: false,
  values: [{ key: "ui", label: "UI" }],
};
const PLATFORMS: CustomFieldDef = {
  key: "platforms", label: "Platforms", type: "enum", multi: true, searchable: false,
  values: [{ key: "ios", label: "iOS" }, { key: "android", label: "Android" }],
};

function renderRows(defs: readonly CustomFieldDef[], values: Record<string, unknown> = {}) {
  const onSet = vi.fn();
  const onCreate = vi.fn();
  const rows = customFieldRows({
    defs, taskType: undefined, values, onSet, onUnset: vi.fn(), onCreate, colorMode: "light",
  });
  render(<div>{rows.map(r => <div key={r.key}>{r.node}</div>)}</div>);
  return { onSet, onCreate };
}

function openAndType(slug: string, text: string): void {
  fireEvent.click(screen.getByTestId(`meta-edit-${slug}`));
  fireEvent.change(screen.getByTestId(`meta-search-${slug}`), { target: { value: text } });
}

afterEach(cleanup);

describe("Create “x” on an open choice field (K150)", () => {
  it("a single open field creates the typed value", () => {
    const { onCreate, onSet } = renderRows([{ ...AREA, allow_new_values: true }]);
    openAndType("area", "Billing");
    const create = screen.getByTestId("meta-create-area");
    expect(create.textContent).toBe("Create “Billing”");
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith("area", "Billing");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("offers no create row for text that names an existing value, by label or key", () => {
    renderRows([{ ...AREA, allow_new_values: true }]);
    openAndType("area", "ui");
    expect(screen.queryByTestId("meta-create-area")).toBeNull();
  });

  it("a multi open field sends the current list plus the new value", () => {
    const { onCreate } = renderRows([{ ...PLATFORMS, allow_new_values: true }], { platforms: ["ios"] });
    openAndType("add-to-platforms", "Windows");
    fireEvent.click(screen.getByTestId("meta-create-add-to-platforms"));
    expect(onCreate).toHaveBeenCalledWith("platforms", ["ios", "Windows"]);
  });

  it("does not offer to create a value already on the task", () => {
    renderRows([{ ...PLATFORMS, allow_new_values: true }], { platforms: ["ios"] });
    openAndType("add-to-platforms", "iOS");
    expect(screen.queryByTestId("meta-create-add-to-platforms")).toBeNull();
  });

  it("a closed field never offers to create", () => {
    renderRows([AREA]);
    fireEvent.click(screen.getByTestId("meta-edit-area"));
    expect(screen.queryByTestId("meta-search-area")).toBeNull();
    expect(screen.queryByTestId("meta-create-area")).toBeNull();
  });
});
