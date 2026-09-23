// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./Button.tsx";
import { IconButton } from "./IconButton.tsx";
import { ToolbarButton } from "./ToolbarButton.tsx";

afterEach(cleanup);

/**
 * These primitives have no flow case yet (they are the design-system
 * foundation, B1). Per build-loop's "NEW primitive with no case" rule,
 * each test is written so it would FAIL if the primitive degraded to a
 * bare native element or dropped a state-matrix class — i.e. it asserts
 * the specific behaviour the primitive adds over `<button>`.
 */

describe("Button", () => {
  it("renders a real button that defaults to type=button (never accidental submit)", () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    // Would fail if we rendered a <div> or forgot the type default — a
    // bare <button> in a form defaults to type=submit.
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("lets the caller override type for a submit button", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("bakes in cursor-pointer (K-16) — the fix a bare <button> lacks", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").className).toContain("cursor-pointer");
  });

  it("uses accent-contrast on the primary fill, never text-white (§3a)", () => {
    render(<Button variant="primary">P</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-accent");
    expect(cls).toContain("text-accent-contrast");
    expect(cls).not.toContain("text-white");
  });

  it("carries the danger fill and its hover/active state", () => {
    render(<Button variant="danger">D</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-danger-fg");
    expect(cls).toContain("text-accent-contrast");
    expect(cls).toContain("hover:opacity-90");
    expect(cls).toContain("active:opacity-90");
    expect(cls).not.toContain("text-white");
  });

  it("renders the danger-outline variant as a tinted outline, not a solid fill", () => {
    render(<Button variant="danger-outline">Retry</Button>);
    const cls = screen.getByRole("button", { name: "Retry" }).className;
    // Tone-tinted border + text over a transparent surface…
    expect(cls).toContain("border-danger-fg/40");
    expect(cls).toContain("text-danger-fg");
    expect(cls).toContain("hover:bg-danger-fg/10");
    // …and NOT the solid danger fill, which is what distinguishes it from
    // the `danger` variant.
    expect(cls).not.toContain("bg-danger-fg text-accent-contrast");
    expect(cls).not.toContain("text-white");
  });

  it("renders the warn-outline variant with the warn tone tokens", () => {
    render(<Button variant="warn-outline">Reconcile</Button>);
    const cls = screen.getByRole("button", { name: "Reconcile" }).className;
    expect(cls).toContain("border-warn-fg/40");
    expect(cls).toContain("text-warn-fg");
    expect(cls).toContain("hover:bg-warn-fg/10");
  });

  /**
   * @verifies A311
   *
   * `current` is for a container whose warn/danger tone is decided at
   * render time (SchemaBanner's `outdated`/`future`/`unknown`/`missing`
   * kinds) rather than fixed on the variant name. It must border/hover
   * off `currentColor` and emit no `text-*`/`bg-*`-at-rest utility of
   * its own — one would fight the parent's `text-warn-fg`/
   * `text-danger-fg`, since `cn` concatenates rather than resolving
   * Tailwind conflicts (see `cn.ts`).
   */
  it("renders the current variant as a currentColor outline with no fixed text/bg of its own", () => {
    render(<Button variant="current">Migrate now</Button>);
    const cls = screen.getByRole("button", { name: "Migrate now" }).className;
    expect(cls).toContain("border-current");
    expect(cls).toContain("hover:bg-current/10");
    expect(cls).toContain("active:bg-current/20");
    // No variant-owned text/bg-at-rest colour: it must inherit, not compete.
    expect(cls).not.toMatch(/(?:^|\s)text-(?!accent-contrast)[a-z-]+-fg(?:\s|$)/);
    expect(cls).not.toMatch(/(?:^|\s)bg-(?!bg-surface)[a-z-]+(?:\s|$)/);
  });

  it("lets `current` inherit an ambient text colour set by an ancestor", () => {
    render(
      <div className="text-danger-fg">
        <Button variant="current">Try now</Button>
      </div>,
    );
    const btn = screen.getByRole("button", { name: "Try now" });
    // jsdom resolves `currentColor` against the computed `color`, which
    // in jsdom's non-cascading style engine just needs the class present
    // — the meaningful assertion is that no variant class overrides it.
    expect(btn.className).not.toMatch(/text-danger-fg|text-warn-fg/);
  });

  it("renders the ghost-danger variant as a ghost surface that reddens on hover, not a filled danger", () => {
    render(<Button variant="ghost-danger">Delete</Button>);
    const cls = screen.getByRole("button", { name: "Delete" }).className;
    // Ghost at rest (muted text, no fill) reddening to the danger tone on hover…
    expect(cls).toContain("text-text-secondary");
    expect(cls).toContain("hover:text-danger-fg");
    expect(cls).toContain("hover:bg-danger-fg/10");
    // …and NOT the solid danger fill, which is what distinguishes it from
    // the `danger` variant.
    expect(cls).not.toContain("bg-danger-fg text-accent-contrast");
    expect(cls).not.toContain("text-white");
  });

  it("secondary/ghost carry hover + active state classes", () => {
    const { rerender } = render(<Button variant="secondary">S</Button>);
    let cls = screen.getByRole("button").className;
    expect(cls).toContain("hover:bg-bg-muted");
    expect(cls).toContain("active:bg-bg-muted-hover");
    rerender(<Button variant="ghost">G</Button>);
    cls = screen.getByRole("button").className;
    expect(cls).toContain("hover:bg-bg-muted");
    expect(cls).toContain("active:bg-bg-muted-hover");
  });

  it("gives each size its own single height (the align fix) and named type scale", () => {
    const { rerender } = render(<Button size="sm">x</Button>);
    let cls = screen.getByRole("button").className;
    expect(cls).toContain("h-7");
    expect(cls).toContain("text-label");
    rerender(<Button size="md">x</Button>);
    cls = screen.getByRole("button").className;
    expect(cls).toContain("h-8");
    expect(cls).toContain("text-body");
  });

  it("applies one disabled treatment (opacity + not-allowed) and blocks click", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("disabled:opacity-50");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses rounded-md, never a bare rounded (§2.3)", () => {
    render(<Button>x</Button>);
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toContain("rounded-md");
    expect(classes).not.toContain("rounded");
  });

  it("forwards testId to the DOM as data-testid (declared, not spread)", () => {
    render(<Button testId="save-btn">x</Button>);
    expect(screen.getByTestId("save-btn")).toBeTruthy();
  });

  it("forwards ref to the underlying button (menus/focus need it)", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("merges the className escape hatch after the variant classes", () => {
    render(<Button className="mt-2 w-full">x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("mt-2");
    expect(cls).toContain("w-full");
    // variant classes still present — the merge does not replace them
    expect(cls).toContain("bg-bg-surface");
  });

  it("applies fullWidth", () => {
    render(<Button fullWidth>x</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
  });

  describe("loading", () => {
    it("keeps the label mounted (not display:none) but hides it from the eye and from AT", () => {
      const { rerender } = render(<Button>Save changes</Button>);
      const labelBefore = screen.getByText("Save changes");
      expect(labelBefore.className).not.toContain("invisible");
      expect(labelBefore.getAttribute("aria-hidden")).toBeNull();

      rerender(<Button loading>Save changes</Button>);
      // Still findable via getByText — i.e. still in the DOM and still
      // laid out (an element with display:none is not "hidden" the same
      // way for Testing Library's default visibility check, but more to
      // the point: `visibility: hidden` — unlike `display: none` — keeps
      // the element's box in flow, which is the "does not resize"
      // requirement.jsdom has no real layout engine to assert the
      // pixel width against, so the mechanism itself (invisible, not
      // unmounted) is what this asserts.
      const label = screen.getByText("Save changes");
      expect(label.className).toContain("invisible");
      expect(label.className).not.toContain("hidden");
      expect(label.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders the spinner while loading", () => {
      render(<Button loading>Save</Button>);
      expect(screen.getByTestId("logo-spinner")).toBeTruthy();
    });

    it("does not render a spinner when not loading", () => {
      render(<Button>Save</Button>);
      expect(screen.queryByTestId("logo-spinner")).toBeNull();
    });

    it("never hides the button itself from the accessibility tree, only its stale label", () => {
      render(<Button loading>Save changes</Button>);
      const btn = screen.getByRole("button");
      // The control stays in the tree — aria-hidden would remove it
      // wholesale, not just the stale label.
      expect(btn.getAttribute("aria-hidden")).toBeNull();
    });

    it("forwards a caller-supplied aria-label, so the button is nameable while loading", () => {
      render(
        <Button loading aria-label="Saving changes">
          Save changes
        </Button>,
      );
      // No loading-specific prop for this — Button already forwards
      // aria-label via ButtonHTMLAttributes; the caller decides the
      // wording and when it applies.
      expect(screen.getByRole("button", { name: "Saving changes" })).toBeTruthy();
    });

    it("disables the button while loading, so a duplicate click cannot fire", () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      const btn = screen.getByRole("button");
      expect(btn.hasAttribute("disabled")).toBe(true);
      fireEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("stays disabled if the caller's own disabled is true, independent of loading", () => {
      render(<Button disabled>Save</Button>);
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    });

    it("marks the button aria-busy while loading, not otherwise", () => {
      const { rerender } = render(<Button>Save</Button>);
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
      rerender(<Button loading>Save</Button>);
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
    });
  });
});

describe("IconButton", () => {
  it("requires and applies an accessible name", () => {
    render(<IconButton aria-label="Close">{"✕"}</IconButton>);
    // Would fail for an unlabelled icon button — the whole point of the
    // required aria-label prop.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("is square and rounded-md, with cursor-pointer", () => {
    render(
      <IconButton aria-label="More" size="md">
        {"⋯"}
      </IconButton>,
    );
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("h-8");
    expect(cls).toContain("w-8");
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("cursor-pointer");
  });

  it("reuses the shared variant token map (ghost default)", () => {
    render(<IconButton aria-label="More">{"⋯"}</IconButton>);
    expect(screen.getByRole("button").className).toContain(
      "hover:bg-bg-muted",
    );
  });

  it("renders each size at its own square footprint", () => {
    const { rerender } = render(
      <IconButton aria-label="Remove" size="xs">
        {"✕"}
      </IconButton>,
    );
    let cls = screen.getByRole("button").className;
    expect(cls).toContain("h-6");
    expect(cls).toContain("w-6");

    rerender(
      <IconButton aria-label="Remove" size="sm">
        {"✕"}
      </IconButton>,
    );
    cls = screen.getByRole("button").className;
    expect(cls).toContain("h-7");
    expect(cls).toContain("w-7");

    rerender(
      <IconButton aria-label="Remove" size="md">
        {"✕"}
      </IconButton>,
    );
    cls = screen.getByRole("button").className;
    expect(cls).toContain("h-8");
    expect(cls).toContain("w-8");
  });

  it("renders the touch size as a 44px WCAG 2.5.5 tap target", () => {
    render(
      <IconButton aria-label="More" size="touch">
        {"⋯"}
      </IconButton>,
    );
    const cls = screen.getByRole("button").className;
    // h-11 w-11 = 44px = the 2.5.5 minimum.
    expect(cls).toContain("h-11");
    expect(cls).toContain("w-11");
  });

  it("defaults to the md size (backwards-compatible) when size is omitted", () => {
    render(<IconButton aria-label="More">{"⋯"}</IconButton>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("h-8");
    expect(cls).toContain("w-8");
  });

  it("forwards testId", () => {
    render(
      <IconButton aria-label="Close" testId="modal-close">
        {"✕"}
      </IconButton>,
    );
    expect(screen.getByTestId("modal-close")).toBeTruthy();
  });
});

describe("ToolbarButton", () => {
  it("is a secondary Button preset by default (rest state, no accent)", () => {
    render(<ToolbarButton>Filter</ToolbarButton>);
    const cls = screen.getByRole("button", { name: "Filter" }).className;
    expect(cls).toContain("bg-bg-surface");
    expect(cls).not.toContain("bg-accent-muted");
  });

  it("applies the accent facet look when active", () => {
    render(<ToolbarButton active>Status</ToolbarButton>);
    const cls = screen.getByRole("button", { name: "Status" }).className;
    // Verbatim the FilterDropdown active look.
    expect(cls).toContain("border-accent");
    expect(cls).toContain("bg-accent-muted");
    expect(cls).toContain("text-accent");
  });

  it("carries testId and aria-pressed through to the button", () => {
    render(
      <ToolbarButton testId="advanced-query-toggle" aria-pressed>
        Advanced
      </ToolbarButton>,
    );
    const btn = screen.getByTestId("advanced-query-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
