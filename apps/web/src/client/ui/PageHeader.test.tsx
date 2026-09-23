// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageHeader } from "./PageHeader.tsx";

afterEach(cleanup);

/**
 * PageHeader is the shared title row. Each test below fails if the
 * primitive dropped the thing it asserts: the title heading, the
 * subtitle slot, the actions slot, or the reachability of an action
 * control inside it. The `items-start`/`gap-3` container is the
 * standardized shape, so the last two tests pin it — a regression to
 * `items-baseline`, to `items-center` (UI-1: it centred the title
 * against a taller actions slot and moved it ~1.5px), or to a
 * different gap would re-introduce the cross-view drift this component
 * exists to remove.
 */
describe("PageHeader", () => {
  it("renders a string title as an h1 with the shared title classes", () => {
    render(<PageHeader title="Milestones" />);
    const heading = screen.getByRole("heading", { name: "Milestones", level: 1 });
    expect(heading.tagName).toBe("H1");
    // The converged title typography — a regression to a different size
    // would make the title jump between views.
    expect(heading.className).toContain("text-[1.0714rem]");
    expect(heading.className).toContain("font-semibold");
  });

  it("honours the heading level via `as`", () => {
    render(<PageHeader title="Section" as="h2" />);
    expect(screen.getByRole("heading", { name: "Section", level: 2 }).tagName).toBe("H2");
  });

  it("renders a node title as-is without wrapping it in a heading", () => {
    render(<PageHeader title={<span data-testid="custom-title">Custom</span>} />);
    expect(screen.getByTestId("custom-title")).toBeTruthy();
    // No heading was synthesized around a node title.
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the subtitle slot", () => {
    render(
      <PageHeader
        title="T"
        subtitle={<p data-testid="sub">the subtitle</p>}
      />,
    );
    expect(screen.getByTestId("sub").textContent).toBe("the subtitle");
  });

  it("renders the actions slot and its controls stay reachable", () => {
    const onClick = vi.fn();
    render(
      <PageHeader
        title="T"
        actions={<button type="button" onClick={onClick}>Do it</button>}
      />,
    );
    const btn = screen.getByRole("button", { name: "Do it" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("omits the actions container when actions is falsy", () => {
    // The `cond && <…>` idiom passes `false`; that must render no empty
    // flex slot (it would otherwise add stray gap to the right edge).
    const { container } = render(<PageHeader title="T" actions={false} />);
    // header has exactly one child (the title column), no actions div.
    const header = container.querySelector("header");
    expect(header?.children.length).toBe(1);
  });

  it("passes testId through to the header element", () => {
    render(<PageHeader title="T" testId="page-header" />);
    expect(screen.getByTestId("page-header").tagName).toBe("HEADER");
  });

  // UI-1: this asserted `items-center`, which was the DEFECT, not the
  // contract. The row takes the height of its taller child, so centring
  // a 21.45px title against a 24.5px actions slot pushed the title down
  // ~1.5px — and only on the views that pass `actions`, so the title
  // drifted as you switched tabs. `items-start` is the fix, and this
  // expectation was holding the bug in place.
  it("uses the standardized items-start / gap-3 container", () => {
    const { container } = render(<PageHeader title="T" />);
    const cls = container.querySelector("header")?.className ?? "";
    expect(cls).toContain("items-start");
    expect(cls).not.toContain("items-center");
    expect(cls).toContain("justify-between");
    expect(cls).toContain("gap-3");
  });

  /**
   * UI-1, the regression this component exists to prevent: the title's
   * vertical position must not depend on whether `actions` is present,
   * or on how tall it is.
   *
   * jsdom has no layout, so an offsetTop comparison would pass on any
   * CSS whatsoever. What IS assertable is the mechanism: the row pins
   * both children to the top rather than centring the shorter one, and
   * the actions slot reserves the control height so it cannot collapse
   * the row either. Both halves are checked — dropping either one
   * re-opens the drift.
   */
  it("pins the title to the top independently of the actions slot (UI-1)", () => {
    const without = render(<PageHeader title="T" />);
    const bare = without.container.querySelector("header")?.className ?? "";
    cleanup();

    const withActions = render(
      <PageHeader
        title="T"
        actions={<button type="button" className="h-8">Tall action</button>}
      />,
    );
    const header = withActions.container.querySelector("header");
    const withCls = header?.className ?? "";

    // Same alignment either way: the title is top-aligned, never
    // centred against a taller actions slot.
    expect(bare).toContain("items-start");
    expect(withCls).toContain("items-start");
    expect(withCls).not.toContain("items-center");

    // And the actions container reserves the sm control height, so a
    // short actions node cannot shrink the row under the title either.
    const actionsSlot = header?.children[1];
    expect(actionsSlot?.className).toContain("min-h-7");
  });
});
