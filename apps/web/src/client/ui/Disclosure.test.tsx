// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Disclosure } from "./Disclosure.tsx";

/**
 * `ui/Disclosure.tsx` exists because Ken hit an error page reading a
 * literal `▸ Show details` — the browser's own `<details>` marker,
 * unsuppressed, on three call sites that each styled their summary
 * differently.
 *
 * What these tests hold:
 *  - the element really is a native `<details>`/`<summary>` (the whole
 *    reason we did not reimplement it with a button and `useState`)
 *  - the marker-kill hook (`.loctt-disclosure`) is on the element, so the
 *    stylesheet's two rules have something to bind to
 *  - our own caret is drawn, is decorative, and reflects the open state
 *  - `data-testid` lands on the `<details>`, which `git-sync-details` and
 *    `git-rekey-ulids` already depend on, and coexists with `className`
 *
 * Not covered here, deliberately: that the conditional spread avoids
 * emitting `data-testid={undefined}`. React drops an undefined attribute
 * on its own, so an unconditional `data-testid={testId}` is
 * indistinguishable at render time — a test for it survived its own
 * mutation. The spread is a `exactOptionalPropertyTypes` *type*
 * obligation, caught by `tsc --build`, and is left to that gate.
 *
 * The stylesheet rules THEMSELVES are pinned by
 * `styles/disclosureMarker.test.ts`: jsdom never loads the compiled
 * Tailwind output, so `getComputedStyle(summary).listStyleType` here
 * would report jsdom's default no matter what the CSS says, and the
 * `-webkit-` pseudo-element is not observable from script at all. The
 * class assertion below is the render-side half; the source parse is the
 * other half. Neither alone would go red if someone deleted the rule.
 */

afterEach(cleanup);

describe("Disclosure", () => {
  it("renders a real native <details>/<summary>, not a button+state reimplementation", () => {
    render(
      <Disclosure summary="Show details">
        <p>body</p>
      </Disclosure>,
    );
    const summary = screen.getByText("Show details").closest("summary");
    expect(summary).not.toBeNull();
    const details = summary?.parentElement;
    expect(details?.tagName).toBe("DETAILS");
    // Uncontrolled: the DOM's own `open` attribute is the truth, and it
    // starts closed with no React state involved.
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("carries the .loctt-disclosure marker-kill hook on the <details>", () => {
    // The two rules that actually remove the browser marker
    // (`list-style: none` and `::-webkit-details-marker{display:none}`)
    // are keyed off this class in `styles/index.css`. Without the class
    // the rules bind to nothing and the native `▸` is back — which is
    // the reported bug.
    render(<Disclosure summary="Show details">body</Disclosure>);
    const details = screen.getByText("Show details").closest("details");
    expect(details?.className).toContain("loctt-disclosure");
  });

  it("draws our own caret, decorative, sized for the 14px text base", () => {
    render(<Disclosure summary="Show details">body</Disclosure>);
    const caret = screen.getByTestId("disclosure-caret");
    expect(caret.tagName.toLowerCase()).toBe("svg");
    // Decorative: the summary's text is the accessible name, so the
    // caret must not be announced alongside it.
    expect(caret.getAttribute("aria-hidden")).toBe("true");
    // The caret is the chevronRight path; it is rotated by CSS on
    // `[open]` rather than swapped for chevronDown, so this exact `d`
    // is what both states render.
    expect(caret.querySelector("path")?.getAttribute("d")).toBe("M6 4l4 4-4 4");
  });

  it("flips the caret via the [open] CSS hook, without swapping the icon or holding state", () => {
    render(<Disclosure summary="Show details">body</Disclosure>);
    const details = screen.getByText("Show details").closest("details") as HTMLDetailsElement;
    const caret = screen.getByTestId("disclosure-caret");
    // `className` on an SVGElement is an SVGAnimatedString, not a string,
    // so read the attribute rather than the property.
    expect(caret.getAttribute("class")).toContain("loctt-disclosure-caret");

    // Opening the native element must change the DOM in the way the CSS
    // selector `.loctt-disclosure[open] > summary .loctt-disclosure-caret`
    // reads — i.e. the `open` attribute appears on the element that
    // carries `.loctt-disclosure`, and the caret stays a descendant of
    // its summary. If the caret were moved out of the summary, or the
    // hook class moved off the <details>, the rotation silently stops.
    details.open = true;
    expect(details.hasAttribute("open")).toBe(true);
    expect(details.className).toContain("loctt-disclosure");
    expect(details.querySelector("summary")?.contains(caret)).toBe(true);
    // Still the same single icon — no chevronDown swap, so no state.
    expect(screen.getAllByTestId("disclosure-caret")).toHaveLength(1);
    expect(caret.querySelector("path")?.getAttribute("d")).toBe("M6 4l4 4-4 4");
  });

  it("puts data-testid on the <details> itself — git-sync-details/git-rekey-ulids depend on it", () => {
    render(
      <Disclosure data-testid="git-sync-details" summary="Show full breakdown">
        <ul data-testid="git-sync-breakdown">
          <li>3 taken from the branch</li>
        </ul>
      </Disclosure>,
    );
    const el = screen.getByTestId("git-sync-details");
    expect(el.tagName).toBe("DETAILS");
    // And the body is inside it, so the existing tests' "expand then read
    // the breakdown" flow still has one element to operate on.
    expect(el.contains(screen.getByTestId("git-sync-breakdown"))).toBe(true);
  });

  it("applies the canonical summary typography, and className goes to the wrapper not the summary", () => {
    // One aesthetic for all three migrated sites: tertiary text at the
    // small size, pointer cursor, unselectable. GitSyncPanel's old
    // `text-accent` is deliberately gone.
    render(
      <Disclosure summary="Show details" className="mb-1">
        body
      </Disclosure>,
    );
    const summary = screen.getByText("Show details").closest("summary") as HTMLElement;
    expect(summary.className).toContain("text-text-tertiary");
    expect(summary.className).toContain("text-[0.8571rem]");
    expect(summary.className).toContain("cursor-pointer");
    expect(summary.className).toContain("select-none");
    expect(summary.className).not.toContain("text-accent");
    // The caller's className is layout-only and belongs on the wrapper.
    expect(summary.className).not.toContain("mb-1");
    expect(summary.closest("details")?.className).toContain("mb-1");
  });

  it("keeps className and data-testid independent on the wrapper (ReconcilePanel passes both)", () => {
    // `git-rekey-ulids` is rendered with `className="mt-1 text-text-tertiary"`
    // AND a testid. An implementation that let one overwrite the other
    // would break that call site while both single-prop tests stayed green.
    render(
      <Disclosure
        data-testid="git-rekey-ulids"
        className="mt-1 text-text-tertiary"
        summary="Show the IDs that decided it"
      >
        body
      </Disclosure>,
    );
    const el = screen.getByTestId("git-rekey-ulids");
    expect(el.tagName).toBe("DETAILS");
    expect(el.className).toContain("mt-1");
    expect(el.className).toContain("text-text-tertiary");
    expect(el.className).toContain("loctt-disclosure");
  });
});
