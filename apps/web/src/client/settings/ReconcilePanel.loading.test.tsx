// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RekeyPlan } from "../api/hooks/useGit.ts";
import { RekeyPreview } from "./ReconcilePanel.tsx";

/**
 * @verifies A307 (progress labels converted to `Button`'s `loading`)
 *
 * "Confirm rekey" used to re-spell itself as "Renumbering…" while the
 * mutation was in flight. Two defects in one: the button's WIDTH changed
 * mid-action (the exact resize `Button.loading`'s invisible-content
 * design exists to prevent — Ken's own spec: "the content is invisible
 * (but it still takes up the same space to prevent resize)"), and no
 * spinner was shown at all, only `disabled`.
 *
 * `RekeyPreview` takes its mutation object as a prop, so the pending and
 * idle states are both reachable without mocking a hook — the assertions
 * below are on the real component, not a stand-in.
 *
 * The two things that must hold while loading, per `Button.tsx`'s
 * documented trap: the accessible name SURVIVES (hiding the visible
 * label from AT removes the name unless the caller passes `aria-label`,
 * which is the whole reason this conversion is not just deleting a
 * ternary), and the spinner is actually rendered.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

// Typed, not cast: an `as unknown as RekeyPlan` fixture here silently
// had the wrong field names and every assertion below died on a render
// crash instead of on the thing it was testing.
function plan(): RekeyPlan {
  return {
    losers: [{
      key: "T-1",
      loserId: "01LOSER",
      loserCreatedAt: "2026-01-02T00:00:00Z",
      keeperId: "01KEEPER",
      keeperCreatedAt: "2026-01-01T00:00:00Z",
      tiebreak: "created_at",
      newKey: "T-2",
    }],
    skipped: [],
  };
}

/** A minimal stand-in for `useConfirmRekey()`'s return, pending or not. */
function confirmStub(isPending: boolean) {
  return {
    mutate: () => {},
    isPending,
    isError: false,
    error: null,
  } as unknown as Parameters<typeof RekeyPreview>[0]["confirm"];
}

describe("A307: the rekey confirm button uses the spinner, not a label swap", () => {
  it("keeps the same visible label text while pending, so the button cannot resize", () => {
    const { unmount } = render(
      <RekeyPreview plan={plan()} confirm={confirmStub(false)} onConfirmed={() => {}} />,
    );
    // Idle: the label is the button's text.
    expect(screen.getByTestId("git-rekey-confirm").textContent).toBe("Confirm rekey");
    unmount();

    render(<RekeyPreview plan={plan()} confirm={confirmStub(true)} onConfirmed={() => {}} />);
    // Pending: the SAME text is still in the DOM and still laid out.
    // jsdom has no layout engine to measure px width with, so the
    // mechanism is what is asserted — the label was not swapped for a
    // shorter/longer progress word, and it was not unmounted.
    const btn = screen.getByTestId("git-rekey-confirm");
    expect(btn.textContent).toContain("Confirm rekey");
    expect(btn.textContent).not.toContain("Renumbering");
  });

  it("keeps its accessible name while pending", () => {
    render(<RekeyPreview plan={plan()} confirm={confirmStub(true)} onConfirmed={() => {}} />);
    // The visible label is aria-hidden while loading, so without the
    // explicit aria-label this button would be NAMELESS — exactly the
    // trap Button.tsx's docstring warns about.
    expect(screen.getByRole("button", { name: "Confirm rekey" })).toBeTruthy();
  });

  it("shows the brand spinner and marks itself aria-busy while pending", () => {
    render(<RekeyPreview plan={plan()} confirm={confirmStub(true)} onConfirmed={() => {}} />);
    const btn = screen.getByTestId("git-rekey-confirm");
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.querySelector("[data-testid='logo-spinner']")).toBeTruthy();
  });

  it("shows no spinner and is not busy when idle", () => {
    render(<RekeyPreview plan={plan()} confirm={confirmStub(false)} onConfirmed={() => {}} />);
    const btn = screen.getByTestId("git-rekey-confirm");
    expect(btn.getAttribute("aria-busy")).toBeNull();
    expect(btn.querySelector("[data-testid='logo-spinner']")).toBeNull();
  });
});
