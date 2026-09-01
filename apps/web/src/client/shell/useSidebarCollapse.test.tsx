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

  // The `[` binding moved to the global shortcut registry
  // (`shortcuts.ts` / `useShortcuts.ts`) in M4.8, so the two tests
  // that used to live here — "toggles on `[`" and "ignores `[` while
  // an input is focused" — no longer have a listener in this hook to
  // exercise. They are not dropped: `useShortcuts.test.ts` asserts the
  // dispatch and both suppression rules against the registry, and
  // `flow-accessibility.spec.ts` (A11Y-6) asserts `[` actually
  // collapses the rendered sidebar end to end, which is a stronger
  // claim than the hook-level version made.
  //
  // What stays here is what this hook still owns: the persisted state
  // (SHL-12), which is the half the shortcut path calls into.
});
