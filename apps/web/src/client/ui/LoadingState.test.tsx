// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingState } from "./LoadingState.tsx";

/**
 * docs/dev/design/design-review.md §A3: loading placeholders must announce to screen
 * readers. The ~14 ad-hoc `<div>Loading…</div>` spellings had no live
 * region; this component bakes one in. If the region ever loses its
 * status role, these go red.
 */
afterEach(cleanup);

describe("LoadingState", () => {
  it("is a polite live region (role=status, aria-busy) carrying the message", () => {
    render(<LoadingState>Loading projects…</LoadingState>);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("Loading projects…");
    expect(region.getAttribute("aria-busy")).toBe("true");
  });

  it("defaults to the padded settings treatment but accepts a className", () => {
    const { rerender } = render(<LoadingState>Loading…</LoadingState>);
    expect(screen.getByRole("status").className).toContain("p-8");
    rerender(<LoadingState className="text-[0.9286rem]">Loading…</LoadingState>);
    expect(screen.getByRole("status").className).toBe("text-[0.9286rem]");
  });

  it("shows the brand spinner instead of visible text (Ken's objection was to seeing the text)", () => {
    render(<LoadingState>Loading projects…</LoadingState>);
    expect(screen.getByTestId("logo-spinner")).toBeTruthy();
  });

  it("keeps the message announced via sr-only, not display:none — the text still exists for AT", () => {
    render(<LoadingState>Loading projects…</LoadingState>);
    const message = screen.getByText("Loading projects…");
    expect(message.className).toContain("sr-only");
    // Still inside the role=status region, so it is still the thing an
    // AT announces — this is the same node the first test's textContent
    // check reads.
    expect(screen.getByRole("status").textContent).toBe("Loading projects…");
  });
});
