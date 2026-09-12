// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollToHash } from "./useScrollToHash.ts";

// The hook reads the hash from the router; stub the selector so the test
// controls it without a full router mount.
let currentHash = "";
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { hash: currentHash } }),
}));

function Probe(): null {
  useScrollToHash();
  return null;
}

const scrolled: string[] = [];

beforeEach(() => {
  currentHash = "";
  scrolled.length = 0;
  vi.useFakeTimers();
  // jsdom has no scrollIntoView; record which element it was called on.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this.id);
  };
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** Advance a batch of rAF ticks (the hook polls on animation frames). */
function flushFrames(n: number): void {
  for (let i = 0; i < n; i += 1) vi.advanceTimersToNextFrame();
}

describe("useScrollToHash (K76)", () => {
  it("scrolls the hash target into view and highlights it", () => {
    const el = document.createElement("div");
    el.id = "comment-abc";
    document.body.appendChild(el);
    currentHash = "#comment-abc";

    render(<Probe />);
    flushFrames(2);

    expect(scrolled).toContain("comment-abc");
    expect(el.getAttribute("data-hash-target")).toBe("true");
  });

  it("removes the highlight after the timeout, so a later link re-triggers it", () => {
    const el = document.createElement("div");
    el.id = "field-timezone";
    document.body.appendChild(el);
    currentHash = "#field-timezone";

    render(<Probe />);
    flushFrames(2);
    expect(el.getAttribute("data-hash-target")).toBe("true");

    vi.advanceTimersByTime(2000);
    expect(el.hasAttribute("data-hash-target")).toBe(false);
  });

  it("waits for a target that mounts a few frames late", () => {
    currentHash = "#comment-late";
    render(<Probe />);
    flushFrames(3);
    // Not there yet.
    expect(scrolled).not.toContain("comment-late");

    // It appears (async data landed), and a later frame finds it.
    const el = document.createElement("div");
    el.id = "comment-late";
    document.body.appendChild(el);
    flushFrames(3);

    expect(scrolled).toContain("comment-late");
  });

  it("does nothing without a hash", () => {
    currentHash = "";
    const el = document.createElement("div");
    el.id = "anything";
    document.body.appendChild(el);

    render(<Probe />);
    flushFrames(5);

    expect(scrolled).toHaveLength(0);
    expect(el.hasAttribute("data-hash-target")).toBe(false);
  });

  it("gives up on a target that never appears (a deleted comment) without erroring", () => {
    currentHash = "#comment-gone";
    render(<Probe />);
    // More than the frame bound; must stop, not loop forever.
    flushFrames(50);
    expect(scrolled).toHaveLength(0);
  });
});
