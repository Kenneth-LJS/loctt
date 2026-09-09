// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requestSidebarCollapse, useSidebarCollapse } from "./useSidebarCollapse.ts";

const KEY = "tt-sidebar-collapsed";

/** Set the viewport width and let a resize listener react. */
function setWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  setWidth(1200); // wide by default
});

afterEach(() => {
  window.localStorage.clear();
  setWidth(1200);
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

/**
 * R2: on a narrow (mobile) viewport the sidebar used to force-collapse
 * to an unlabelled icon rail that could not be dismissed or expanded
 * (`canToggle` was false below the breakpoint). It is now a dismissible
 * overlay: the toggle works, opening a transient overlay that does not
 * touch the persisted wide-viewport preference.
 */
describe("useSidebarCollapse — mobile overlay (R2)", () => {
  it("starts collapsed on a narrow viewport but can be toggled", () => {
    // Covers R2 (review item; no case ID)
    setWidth(380);
    const { result } = renderHook(() => useSidebarCollapse());
    expect(result.current.narrow).toBe(true);
    expect(result.current.collapsed).toBe(true);
    // R2: the toggle is enabled on mobile (was disabled before).
    expect(result.current.canToggle).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false); // overlay opened
  });

  it("does not persist the mobile overlay state to localStorage", () => {
    // Covers R2 (review item; no case ID) — opening the overlay on a phone must not overwrite
    // the desktop preference.
    setWidth(380);
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => result.current.toggle());
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("closes the overlay when requestSidebarCollapse fires (tap-away / nav)", () => {
    // Covers R2 (review item; no case ID)
    setWidth(380);
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => result.current.toggle()); // open
    expect(result.current.collapsed).toBe(false);
    act(() => { requestSidebarCollapse(); });
    expect(result.current.collapsed).toBe(true); // dismissed
  });

  it("keeps the wide-viewport preference independent of the overlay", () => {
    // Covers R2 (review item; no case ID) — a user who collapsed the sidebar on desktop still
    // finds it collapsed when the window grows back, regardless of any
    // mobile overlay toggling.
    window.localStorage.setItem(KEY, "1"); // collapsed on desktop
    setWidth(380);
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => result.current.toggle()); // open the mobile overlay
    expect(result.current.collapsed).toBe(false);
    // Grow back to a wide window: the overlay closes and the stored
    // desktop preference (collapsed) governs again.
    act(() => {
      setWidth(1200);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.narrow).toBe(false);
    expect(result.current.collapsed).toBe(true);
  });
});
