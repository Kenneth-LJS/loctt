// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOGO_L, LOGO_O, LogoMark } from "./LogoMark.tsx";

afterEach(cleanup);

describe("LogoMark", () => {
  it("renders the L and the o as two paths filled from tokens", () => {
    render(<LogoMark />);
    const svg = screen.getByTestId("logo-mark");
    const l = svg.querySelector('path[data-part="l"]');
    const o = svg.querySelector('path[data-part="o"]');
    // Regression: collapsing back to one evenodd path (or hard-coding a
    // hex) would lose the per-part, theme-following colours.
    expect(l?.getAttribute("fill")).toBe("var(--accent)");
    expect(o?.getAttribute("fill")).toBe("var(--text-primary)");
    expect(l?.getAttribute("d")).toBe(LOGO_L);
    expect(o?.getAttribute("d")).toBe(LOGO_O);
  });

  it("is decorative beside the wordmark and named when standing alone", () => {
    const { rerender } = render(<LogoMark />);
    const svg = screen.getByTestId("logo-mark");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();

    rerender(<LogoMark label="LocTT" />);
    expect(screen.getByRole("img", { name: "LocTT" })).toBe(svg);
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("sizes the svg from the size prop", () => {
    render(<LogoMark size={40} />);
    const svg = screen.getByTestId("logo-mark");
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
  });
});
