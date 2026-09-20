// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IconPicker } from "./IconPicker.tsx";

afterEach(() => { cleanup(); });

/**
 * IconPicker (Part A): a searchable, clearable picker over the app's SVG
 * icon set. The assertions turn on the value the picker reports through
 * `onChange` — the stored icon name, or undefined when cleared — and on
 * the search box filtering the option list.
 */

function Harness({ initial }: { readonly initial?: string | undefined }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div>
      <IconPicker
        value={value}
        onChange={setValue}
        testId="icon-trigger"
        listTestId="icon-list"
        searchTestId="icon-search"
        clearTestId="icon-clear"
      />
      <output data-testid="picked">{value ?? "(none)"}</output>
    </div>
  );
}

describe("IconPicker", () => {
  it("picks an icon by name and reports it through onChange", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-option-flag"));
    expect(screen.getByTestId("picked").textContent).toBe("flag");
  });

  it("is searchable — typing filters the option list", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    // The set is well past the search threshold, so the box is shown.
    const search = screen.getByTestId("icon-search");
    fireEvent.change(search, { target: { value: "calend" } });
    // The matching option is present…
    expect(screen.getByTestId("icon-option-calendar")).toBeTruthy();
    // …and a non-matching one is filtered out.
    expect(screen.queryByTestId("icon-option-flag")).toBeNull();
  });

  it("is clearable back to no icon", () => {
    render(<Harness initial="star" />);
    expect(screen.getByTestId("picked").textContent).toBe("star");
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-clear"));
    expect(screen.getByTestId("picked").textContent).toBe("(none)");
  });

  it("keeps a stored icon LocTT does not draw selectable rather than dropping it", () => {
    // A hand-authored icon (an emoji, another set's name) is valid on disk;
    // the picker must keep it as the current selection.
    render(<Harness initial="🚀" />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    expect(screen.getByTestId("icon-option-🚀")).toBeTruthy();
    expect(screen.getByTestId("picked").textContent).toBe("🚀");
  });
});
