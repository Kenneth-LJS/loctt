// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSidebarCollapse } from "./useSidebarCollapse.ts";

const KEY = "tt-sidebar-collapsed";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

/**
 * @verifies SHL-12
 *
 * A fresh `renderHook` is the reload: the hook re-reads localStorage on
 * mount with no in-memory state carried over. Route changes do not
 * remount it — it lives above the router in AppShell — so persistence
 * across a reload is the stronger of the two claims the case makes.
 */
describe("useSidebarCollapse", () => {
  it("defaults to expanded when nothing is stored", () => {
    const { result } = renderHook(() => useSidebarCollapse());
    expect(result.current.collapsed).toBe(false);
  });

  it("reads the persisted collapsed state on mount", () => {
    window.localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useSidebarCollapse());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggles and persists to localStorage under the mockup's key", () => {
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe("0");
  });

  it("toggles on the `[` key when no input is focused", () => {
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    });
    expect(result.current.collapsed).toBe(true);
  });

  it("ignores `[` while a text input is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "[", bubbles: true }),
      );
    });
    expect(result.current.collapsed).toBe(false);
    input.remove();
  });
});
