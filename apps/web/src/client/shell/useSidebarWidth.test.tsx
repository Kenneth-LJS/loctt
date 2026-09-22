// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  useSidebarWidth,
} from "./useSidebarWidth.ts";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("clampSidebarWidth", () => {
  it("clamps below the minimum up to the minimum", () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
  });
  it("clamps above the maximum down to the maximum", () => {
    expect(clampSidebarWidth(10_000)).toBe(MAX_SIDEBAR_WIDTH);
  });
  it("rounds and passes through an in-range value", () => {
    expect(clampSidebarWidth(300.7)).toBe(301);
  });
  it("falls back to the default for a non-finite value", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("useSidebarWidth", () => {
  /**
   * A fresh renderHook is the reload: the hook re-reads localStorage on
   * mount with no in-memory state carried over.
   */
  it("defaults to DEFAULT_SIDEBAR_WIDTH when nothing is stored", () => {
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("restores a stored value on mount", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(320);
  });

  it("clamps an out-of-range stored value on read", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, "9999");
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("falls back to the default for an unparseable stored value", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, "not-a-number");
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("setWidth clamps and persists", () => {
    const { result } = renderHook(() => useSidebarWidth());
    act(() => result.current.setWidth(300));
    expect(result.current.width).toBe(300);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("300");

    // Below the min is clamped, both in state and in the store.
    act(() => result.current.setWidth(10));
    expect(result.current.width).toBe(MIN_SIDEBAR_WIDTH);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(MIN_SIDEBAR_WIDTH));
  });

  /**
   * SHL-18 discipline: a store that throws on read/write must not take
   * the hook (and thus the shell) down. It degrades to the default and
   * drops the write.
   */
  it("survives a throwing localStorage without crashing", () => {
    const orig = window.localStorage;
    const throwing = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
      clear: () => {},
      removeItem: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", { value: throwing, configurable: true });
    try {
      const { result } = renderHook(() => useSidebarWidth());
      expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
      // The write throws internally but is swallowed; state still updates.
      act(() => { result.current.setWidth(300); });
      expect(result.current.width).toBe(300);
    } finally {
      Object.defineProperty(window, "localStorage", { value: orig, configurable: true });
    }
  });
});
