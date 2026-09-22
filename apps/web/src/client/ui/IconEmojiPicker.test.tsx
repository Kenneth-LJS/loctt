// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IconEmojiPicker } from "./IconEmojiPicker.tsx";

afterEach(() => { cleanup(); });

/**
 * K104 — the icon picker (A279's portalled two-tab grid).
 *
 * Every behaviour the old Combobox-based `IconPicker` asserted is
 * carried forward here (pick, search, clear, keep-an-unknown-value), so
 * replacing the control did not quietly drop a guarantee. The new
 * assertions cover what A279 added: the two tabs over one search box,
 * and the free-type emoji escape hatch.
 */

function Harness({ initial }: { readonly initial?: string | undefined }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div>
      <IconEmojiPicker
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

describe("IconEmojiPicker", () => {
  it("picks a Lucide icon and reports it through onChange", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-option-flag"));
    expect(screen.getByTestId("picked").textContent).toBe("flag");
  });

  it("is searchable — typing filters the icon grid", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "calend" } });
    expect(screen.getByTestId("icon-option-calendar")).toBeTruthy();
    expect(screen.queryByTestId("icon-option-flag")).toBeNull();
  });

  it("the one search box filters the Emoji tab too, by keyword", () => {
    // A279's reason for ONE box: a user wanting "a rocket" does not know
    // which source has one. Searching on the Icons tab must already have
    // narrowed Emoji, so switching tabs lands on matches, not on
    // everything.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "rocket" } });
    fireEvent.click(screen.getByTestId("icon-list-tab-emoji"));
    expect(screen.getByTestId("icon-option-🚀")).toBeTruthy();
    // A non-matching emoji is filtered out.
    expect(screen.queryByTestId("icon-option-☕")).toBeNull();
  });

  it("picks a curated emoji from the Emoji tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-list-tab-emoji"));
    fireEvent.click(screen.getByTestId("icon-option-✅"));
    expect(screen.getByTestId("picked").textContent).toBe("✅");
  });

  it("accepts a free-typed emoji the curated list does not carry", () => {
    // The pinned escape hatch (A279): always visible, not a third tab.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-list-free"), { target: { value: "🦄" } });
    fireEvent.click(screen.getByTestId("icon-list-free-apply"));
    expect(screen.getByTestId("picked").textContent).toBe("🦄");
  });

  it("is clearable back to no icon", () => {
    render(<Harness initial="star" />);
    expect(screen.getByTestId("picked").textContent).toBe("star");
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-clear"));
    expect(screen.getByTestId("picked").textContent).toBe("(none)");
  });

  it("keeps a stored icon the catalog does not know selectable rather than dropping it", () => {
    // A279's field-local degradation: a hand-authored value is valid on
    // disk and stays the current selection.
    render(<Harness initial="🛸" />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    expect(screen.getByTestId("icon-option-🛸")).toBeTruthy();
    expect(screen.getByTestId("picked").textContent).toBe("🛸");
  });

  it("offers the six pre-K104 names that are not Lucide ids, so stored config keeps rendering", () => {
    // `alert` is NOT a Lucide id. Dropping it would orphan every
    // `icon: alert` already written to a workflow.yaml.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-option-alert"));
    expect(screen.getByTestId("picked").textContent).toBe("alert");
  });
});
