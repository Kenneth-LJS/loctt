// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSelection } from "./useSelection.ts";

/**
 * @verifies BLK-18
 *
 * The clear-on-result-set-change rule. Playwright covers it through the
 * UI; these pin the hook's own contract, where the distinction between
 * "the filter changed" and "we loaded another page" actually lives.
 */
describe("useSelection", () => {
  it("toggles one id without touching the others", () => {
    const { result } = renderHook(() => useSelection("k"));

    act(() => { result.current.toggle("a"); });
    act(() => { result.current.toggle("b"); });
    expect(result.current.count).toBe(2);

    act(() => { result.current.toggle("a"); });
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.isSelected("b")).toBe(true);
  });

  it("clears when the result-set key changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useSelection(key),
      { initialProps: { key: "filter-a" } },
    );

    act(() => { result.current.toggle("a"); });
    expect(result.current.count).toBe(1);

    rerender({ key: "filter-b" });

    // A surviving selection here is exactly what BLK-18 forbids: the
    // bar would keep claiming a count while operating on rows the user
    // can no longer see.
    expect(result.current.count).toBe(0);
  });

  it("keeps the selection when the key is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useSelection(key),
      { initialProps: { key: "filter-a" } },
    );

    act(() => { result.current.toggle("a"); });
    // A re-render is not a result-set change. Clearing here would drop
    // the selection on every unrelated state update.
    rerender({ key: "filter-a" });

    expect(result.current.count).toBe(1);
  });

  it("selectAll replaces the selection with exactly the given ids", () => {
    const { result } = renderHook(() => useSelection("k"));

    act(() => { result.current.toggle("old"); });
    act(() => { result.current.selectAll(["a", "b"]); });

    expect([...result.current.selected].sort()).toEqual(["a", "b"]);
    expect(result.current.isSelected("old")).toBe(false);
  });

  it("clear empties the selection", () => {
    const { result } = renderHook(() => useSelection("k"));
    act(() => { result.current.selectAll(["a", "b"]); });
    act(() => { result.current.clear(); });
    expect(result.current.count).toBe(0);
  });
});
