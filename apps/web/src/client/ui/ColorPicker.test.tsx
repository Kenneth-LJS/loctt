// @vitest-environment jsdom
import type { EntityColor } from "@loctt/contracts";
import { BUILTIN_PALETTE, getPaletteEntry } from "@loctt/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ColorPicker } from "./ColorPicker.tsx";

afterEach(() => { cleanup(); });

/**
 * K103 stage 2 — the entity colour picker, and the resolution behind it.
 *
 * The regressions these cover are the two halves of the ticket:
 *
 *  1. **The picker stores the right SHAPE.** A palette swatch must
 *     store `{palette: id}` — a live reference — and NOT the hex it
 *     happens to resolve to today. Snapshotting is the thing Ken's
 *     ruling forbids, and it is invisible in the UI: a snapshotted
 *     picker looks identical until someone changes the palette.
 *  2. **A stored colour resolves per MODE.** The same stored value must
 *     paint a different hex in light and dark. A site that ignores the
 *     mode still renders *a* colour, so only a two-theme assertion
 *     catches it.
 */

/** Sets the DOM's theme the way `useTheme` reads it back. */
function setTheme(mode: "light" | "dark"): void {
  window.localStorage.setItem("tt-theme", mode);
}

beforeEach(() => {
  window.localStorage.clear();
  setTheme("light");
});

function Harness({ initial }: { readonly initial?: EntityColor | undefined }) {
  const [value, setValue] = useState<EntityColor | undefined>(initial);
  return (
    <div>
      <ColorPicker value={value} onChange={setValue} testId="c" ariaLabel="Colour" />
      {/* The STORED value, serialised — so a test can tell a palette
          reference apart from the hex it resolves to. */}
      <output data-testid="stored">{JSON.stringify(value ?? null)}</output>
    </div>
  );
}

const BLUE = getPaletteEntry("blue");

describe("ColorPicker — what it stores", () => {
  it("stores a palette pick as a LIVE reference, not the resolved hex", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    fireEvent.click(screen.getByTestId("c-palette-blue"));

    // The stored value is the id. If this were the hex, editing the
    // palette entry would no longer repaint this entity — the snapshot
    // Ken's ruling forbids.
    expect(screen.getByTestId("stored").textContent).toBe('{"palette":"blue"}');
    expect(screen.getByTestId("stored").textContent).not.toContain(BLUE?.light ?? "#1868B0");
  });

  it("stores a custom colour as an explicit per-mode pair", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    fireEvent.change(screen.getByTestId("c-custom-light"), { target: { value: "#112233" } });
    fireEvent.change(screen.getByTestId("c-custom-dark"), { target: { value: "#ddeeff" } });
    fireEvent.click(screen.getByTestId("c-custom-apply"));

    // Both halves, not one value reused — K103's whole point is that a
    // custom colour is specified per mode.
    expect(JSON.parse(screen.getByTestId("stored").textContent ?? "null")).toEqual({
      light: "#112233",
      dark: "#ddeeff",
    });
  });

  it("clears to undefined rather than to a hex", () => {
    render(<Harness initial={{ palette: "red" }} />);
    fireEvent.click(screen.getByTestId("c"));
    fireEvent.click(screen.getByTestId("c-clear"));
    expect(screen.getByTestId("stored").textContent).toBe("null");
  });

  it("offers every built-in palette entry", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    // Asserting the options are OFFERED, not just that a value round-
    // trips: a picker that stores "blue" while showing no blue swatch
    // would pass a value-only assertion.
    for (const entry of BUILTIN_PALETTE) {
      expect(screen.getByTestId(`c-palette-${entry.id}`)).toBeTruthy();
    }
  });
});

describe("ColorPicker — what it paints", () => {
  it("paints a palette reference with the LIGHT half in light mode", () => {
    setTheme("light");
    render(<Harness initial={{ palette: "blue" }} />);
    expect(screen.getByTestId("c-swatch").getAttribute("data-color")).toBe(BLUE?.light);
  });

  it("paints the SAME stored reference with the DARK half in dark mode", () => {
    setTheme("dark");
    render(<Harness initial={{ palette: "blue" }} />);
    const painted = screen.getByTestId("c-swatch").getAttribute("data-color");
    expect(painted).toBe(BLUE?.dark);
    // The two halves must actually differ, or this test would pass
    // against a picker that ignores the mode entirely.
    expect(painted).not.toBe(BLUE?.light);
  });

  it("never lets a stored OBJECT reach the painted value", () => {
    render(<Harness initial={{ light: "#101010", dark: "#f0f0f0" }} />);
    const painted = screen.getByTestId("c-swatch").getAttribute("data-color");
    // The exact failure mode this ticket exists to remove: an
    // un-resolved colour stringifies to "[object Object]", which CSS
    // discards, so the entity silently loses its tint.
    expect(painted).not.toContain("object Object");
    expect(painted).toBe("#101010");
  });

  it("renders a pre-K103 bare hex unchanged, in both modes", () => {
    setTheme("light");
    const { unmount } = render(<Harness initial="#abcdef" />);
    expect(screen.getByTestId("c-swatch").getAttribute("data-color")).toBe("#abcdef");
    unmount();

    // Shape 1 means "one value used for BOTH modes" — a single colour
    // must not start resolving to something else in dark mode.
    setTheme("dark");
    render(<Harness initial="#abcdef" />);
    expect(screen.getByTestId("c-swatch").getAttribute("data-color")).toBe("#abcdef");
  });

  it("degrades an unknown palette id to no colour, naming it, without crashing", () => {
    render(<Harness initial={{ palette: "chartreuse" }} />);
    // Field-local degrade: the swatch paints nothing rather than a
    // made-up colour, and the reference is still stored and named so
    // the user knows which one to fix.
    expect(screen.getByTestId("c-swatch").getAttribute("data-color")).toBe("");
    expect(screen.getByTestId("c").textContent).toContain("chartreuse");
    expect(screen.getByTestId("stored").textContent).toBe('{"palette":"chartreuse"}');
  });

  it("seeds the custom wells from the current value, per mode", () => {
    render(<Harness initial={{ palette: "blue" }} />);
    fireEvent.click(screen.getByTestId("c"));
    // "Start from Blue and nudge it" — each well seeds from the half
    // for ITS mode, not from whichever one the theme happens to be.
    expect(screen.getByTestId<HTMLInputElement>("c-custom-light").value)
      .toBe(BLUE?.light.toLowerCase());
    expect(screen.getByTestId<HTMLInputElement>("c-custom-dark").value)
      .toBe(BLUE?.dark.toLowerCase());
  });
});
