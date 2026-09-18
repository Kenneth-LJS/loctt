// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Callout } from "./Callout.tsx";
import { Chip } from "./Chip.tsx";
import { cn } from "./cn.ts";
import { ICON } from "./icons.ts";
import { Select } from "./Select.tsx";
import { TextField } from "./TextField.tsx";

afterEach(cleanup);

describe("cn", () => {
  it("drops falsy entries and space-joins the rest", () => {
    const off = false;
    expect(cn("a", false, undefined, null, "b", off && "c")).toBe("a b");
  });
});

describe("icons", () => {
  it("has one canonical glyph per affordance (no star/close drift)", () => {
    expect(ICON.star).toBe("⭑");
    expect(ICON.close).toBe("✕");
    expect(ICON.caretDown).toBe("▾");
    expect(ICON.more).toBe("⋯");
  });
});

describe("Chip", () => {
  it("renders one height/padding pill (K-6 alignment), rounded-md by default", () => {
    render(<Chip>3</Chip>);
    const chip = screen.getByText("3");
    expect(chip.className).toContain("px-1.5");
    expect(chip.className).toContain("py-0.5");
    expect(chip.className).toContain("text-meta");
    const classes = chip.className.split(/\s+/);
    expect(classes).toContain("rounded-md");
    expect(classes).not.toContain("rounded");
  });

  it("carries the accent variant tokens (theme-aware against row hover, K-15)", () => {
    render(<Chip variant="accent">on</Chip>);
    const cls = screen.getByText("on").className;
    expect(cls).toContain("bg-accent-muted");
    expect(cls).toContain("text-accent");
  });

  it("count variant is tabular", () => {
    render(<Chip variant="count">12</Chip>);
    expect(screen.getByText("12").className).toContain("tabular-nums");
  });

  it("offers a pill shape without pre-deciding away the round count badge", () => {
    render(<Chip shape="pill">9</Chip>);
    expect(screen.getByText("9").className).toContain("rounded-full");
  });

  it("passes testId and title through", () => {
    render(
      <Chip testId="sidebar-count" title="9 tasks">
        9
      </Chip>,
    );
    const el = screen.getByTestId("sidebar-count");
    expect(el.getAttribute("title")).toBe("9 tasks");
  });
});

describe("Select", () => {
  it("is an appearance-none native select with one border/radius token", () => {
    render(
      <Select aria-label="Status">
        <option value="a">A</option>
      </Select>,
    );
    const sel = screen.getByRole("combobox", { name: "Status" });
    expect(sel.tagName).toBe("SELECT");
    const cls = sel.className;
    expect(cls).toContain("appearance-none");
    expect(cls).toContain("border-border-default");
    expect(cls).toContain("rounded-md");
    // room reserved for the themed chevron
    expect(cls).toContain("pr-7");
  });

  it("renders a themed chevron overlay (not the native OS arrow)", () => {
    render(
      <Select aria-label="S">
        <option>A</option>
      </Select>,
    );
    // The caret is an overlaid element so it follows the theme token; a
    // bare <select> would rely on the OS arrow that ignores dark mode.
    expect(screen.getByText(ICON.caretDown)).toBeTruthy();
  });

  it("re-declares a focus ring (appearance-none removed the UA one)", () => {
    render(
      <Select aria-label="S">
        <option>A</option>
      </Select>,
    );
    expect(screen.getByRole("combobox").className).toContain(
      "focus-visible:outline-2",
    );
  });

  it("passes value/onChange/testid through to the select", () => {
    render(
      <Select aria-label="S" defaultValue="b" data-testid="statuses-default">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    const sel = screen.getByTestId("statuses-default");
    if (!(sel instanceof HTMLSelectElement)) throw new Error("not a <select>");
    expect(sel.value).toBe("b");
  });
});

describe("TextField", () => {
  it("renders one input shape with border/radius tokens and AA placeholder token", () => {
    render(<TextField placeholder="Search" />);
    const input = screen.getByPlaceholderText("Search");
    const cls = input.className;
    expect(cls).toContain("border-border-default");
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("placeholder:text-text-tertiary");
  });

  it("wires invalid to aria-invalid AND the danger border together", () => {
    render(<TextField invalid placeholder="x" />);
    const input = screen.getByPlaceholderText("x");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("aria-invalid:border-danger-fg");
  });

  it("does not set aria-invalid when valid", () => {
    render(<TextField placeholder="x" />);
    expect(screen.getByPlaceholderText("x").getAttribute("aria-invalid")).toBeNull();
  });

  it("renders a leadingIcon slot and pads the input for it", () => {
    render(<TextField placeholder="Find" leadingIcon={ICON.more} />);
    expect(screen.getByText(ICON.more)).toBeTruthy();
    expect(screen.getByPlaceholderText("Find").className).toContain("pl-7");
  });

  it("forwards ref and data-testid to the input", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} data-testid="meta-input-title" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByTestId("meta-input-title").tagName).toBe("INPUT");
  });
});

describe("Callout", () => {
  it("renders the tone tokens (anchored, persistent — not a toast)", () => {
    render(<Callout tone="danger">Failed</Callout>);
    const el = screen.getByText("Failed");
    expect(el.className).toContain("bg-danger-bg");
    expect(el.className).toContain("text-danger-fg");
    expect(el.className).toContain("border");
  });

  it("maps each tone to its feedback tokens", () => {
    const { rerender } = render(<Callout tone="warn">w</Callout>);
    expect(screen.getByText("w").className).toContain("bg-warn-bg");
    rerender(<Callout tone="success">s</Callout>);
    expect(screen.getByText("s").className).toContain("bg-success-bg");
    rerender(<Callout tone="info">i</Callout>);
    expect(screen.getByText("i").className).toContain("bg-bg-muted");
  });

  it("defaults role to status and honours an explicit alert", () => {
    const { rerender } = render(<Callout tone="danger">x</Callout>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(
      <Callout tone="danger" role="alert">
        x
      </Callout>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("passes testId through", () => {
    render(
      <Callout tone="danger" testId="query-warnings">
        x
      </Callout>,
    );
    expect(screen.getByTestId("query-warnings")).toBeTruthy();
  });
});
