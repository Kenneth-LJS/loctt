// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageHeader } from "./PageHeader.tsx";

afterEach(cleanup);

/**
 * PageHeader is the shared title row. Each test below fails if the
 * primitive dropped the thing it asserts: the title heading, the
 * subtitle slot, the actions slot, or the reachability of an action
 * control inside it. The `items-center`/`gap-3` container is the
 * standardized shape the migration converged on, so the last test
 * pins it — a regression to `items-baseline` or a different gap would
 * re-introduce the cross-view drift this component exists to remove.
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

  it("uses the standardized items-center / gap-3 container", () => {
    const { container } = render(<PageHeader title="T" />);
    const cls = container.querySelector("header")?.className ?? "";
    expect(cls).toContain("items-center");
    expect(cls).toContain("justify-between");
    expect(cls).toContain("gap-3");
  });
});
