// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOGO_L, LOGO_O } from "./LogoMark.tsx";
import { LogoSpinner } from "./LogoSpinner.tsx";

afterEach(cleanup);

describe("LogoSpinner", () => {
  it("renders one svg with the L and o paths themed from CSS variables, not hardcoded hex", () => {
    render(<LogoSpinner />);
    const svgs = screen.getAllByTestId("logo-spinner");
    // Exactly one inlined SVG element — the whole point of Ken's "dont
    // copy 2 svgs" instruction: one markup, themed by CSS variables, not
    // a light copy and a dark copy switched some other way.
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    const l = svg?.querySelector('path[data-part="l"]');
    const o = svg?.querySelector('path[data-part="o"]');
    expect(l?.getAttribute("fill")).toBe("var(--accent)");
    expect(o?.getAttribute("fill")).toBe("var(--text-primary)");
    // Regression: a hardcoded hex (the source SVG's own `#39A88F`/
    // `#F4F4F3` dark-theme literals) would break light mode silently.
    expect(l?.getAttribute("fill")).not.toMatch(/^#/);
    expect(o?.getAttribute("fill")).not.toMatch(/^#/);
    expect(l?.getAttribute("d")).toBe(LOGO_L);
    expect(o?.getAttribute("d")).toBe(LOGO_O);
  });

  it("carries the scoped animation classes, not the source SVG's bare names", () => {
    render(<LogoSpinner />);
    const svg = screen.getByTestId("logo-spinner");
    // Distinctive (loctt-*) class names, not the source's bare .spin/
    // .pL/.pO — those would collide with anything else in the app using
    // the same short names.
    expect(svg.getAttribute("class")).toContain("loctt-spin");
    const l = svg.querySelector('path[data-part="l"]');
    const o = svg.querySelector('path[data-part="o"]');
    expect(l?.getAttribute("class")).toContain("loctt-spin-l");
    expect(o?.getAttribute("class")).toContain("loctt-spin-o");
  });

  it("keeps the padded viewBox so the rotation does not clip", () => {
    render(<LogoSpinner />);
    expect(screen.getByTestId("logo-spinner").getAttribute("viewBox")).toBe(
      "-19.255 -19.255 102.510 102.510",
    );
  });

  it("sizes the svg from the size prop, including a rem string for scale-aware callers", () => {
    const { rerender } = render(<LogoSpinner size={40} />);
    let svg = screen.getByTestId("logo-spinner");
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");

    rerender(<LogoSpinner size="1.5rem" />);
    svg = screen.getByTestId("logo-spinner");
    expect(svg.getAttribute("width")).toBe("1.5rem");
    expect(svg.getAttribute("height")).toBe("1.5rem");
  });

  it("is decorative by default and named when passed a label", () => {
    const { rerender } = render(<LogoSpinner />);
    let svg = screen.getByTestId("logo-spinner");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();

    rerender(<LogoSpinner label="Loading" />);
    svg = screen.getByTestId("logo-spinner");
    expect(screen.getByRole("img", { name: "Loading" })).toBe(svg);
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });
});
