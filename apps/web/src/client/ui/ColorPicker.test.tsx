// @vitest-environment jsdom
import type { EntityColor } from "@loctt/contracts";
import { BUILTIN_PALETTE, getPaletteEntry } from "@loctt/core/config/color.js";
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
    // Custom is behind a disclosure since the 18-colour redesign — the
    // palette grid is the common case and gets the panel. Opening it is
    // now part of the custom flow.
    fireEvent.click(screen.getByTestId("c-custom-toggle"));
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

describe("ColorPicker — the panel's shape (the 2026-09-22 redesign)", () => {
  /**
   * Ken: *"this is messy"*, about a panel that gave four blocks equal
   * billing. These pin the decisions that answer it, because every one
   * of them is invisible to a value-only assertion: a panel that stored
   * the right colours while looking exactly as cluttered as before
   * would pass all of the tests above.
   */

  it("keeps the custom form collapsed when the stored value is a palette colour", () => {
    render(<Harness initial={{ palette: "blue" }} />);
    fireEvent.click(screen.getByTestId("c"));
    // The clutter fix: the two native wells and the apply button are
    // NOT in the panel until asked for. If they render eagerly, the
    // redesign has silently reverted.
    expect(screen.queryByTestId("c-custom-panel")).toBeNull();
    expect(screen.queryByTestId("c-custom-light")).toBeNull();
    expect(screen.getByTestId("c-custom-toggle").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the custom form up-front when the stored value IS custom", () => {
    render(<Harness initial={{ light: "#112233", dark: "#ddeeff" }} />);
    fireEvent.click(screen.getByTestId("c"));
    // Hiding a user's OWN current value behind a disclosure is worse
    // than the clutter the disclosure saves, so this case opens.
    expect(screen.getByTestId("c-custom-panel")).toBeTruthy();
    expect(screen.getByTestId("c-custom-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId<HTMLInputElement>("c-custom-light").value).toBe("#112233");
  });

  it("offers 'No colour' as the first cell of the grid, not a trailing row", () => {
    render(<Harness initial={{ palette: "red" }} />);
    fireEvent.click(screen.getByTestId("c"));
    const cells = Array.from(
      screen.getByTestId("c-palette").querySelectorAll('[role="radio"]'),
    );
    // Position is the assertion. As a trailing text button it read as
    // an afterthought — the specific thing Ken called messy — so this
    // pins it as cell ONE of the choices, among its alternatives.
    expect(cells[0]).toBe(screen.getByTestId("c-clear"));
    expect(cells).toHaveLength(BUILTIN_PALETTE.length + 1);
  });

  it("marks the selected swatch with a glyph, not by colour alone", () => {
    render(<Harness initial={{ palette: "green" }} />);
    fireEvent.click(screen.getByTestId("c"));
    const selected = screen.getByTestId("c-palette-green");
    const other = screen.getByTestId("c-palette-red");
    // A ring in the accent colour is invisible on the accent swatch and
    // ambiguous on a dark one, so selection carries a non-colour
    // channel: a check glyph, plus `aria-checked` for AT.
    expect(selected.querySelector("svg")).toBeTruthy();
    expect(other.querySelector("svg")).toBeNull();
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(other.getAttribute("aria-checked")).toBe("false");
  });

  it("exposes the grid as a radiogroup with exactly one tab stop", () => {
    render(<Harness initial={{ palette: "green" }} />);
    fireEvent.click(screen.getByTestId("c"));
    const grid = screen.getByTestId("c-palette");
    expect(grid.getAttribute("role")).toBe("radiogroup");
    // Roving focus: Tab reaches the grid ONCE and the arrows do the
    // rest. Eighteen tab stops is not navigation, it is a penalty.
    const stops = Array.from(grid.querySelectorAll('[role="radio"]'))
      .filter(cell => cell.getAttribute("tabIndex") === "0"
        || (cell as HTMLElement).tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(screen.getByTestId("c-palette-green"));
  });

  it("moves focus by one on Left/Right and by a full row on Up/Down", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    const grid = screen.getByTestId("c-palette");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="radio"]'));

    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[1]);

    // The two-dimensional part: Down is a ROW, not a cell. A picker
    // that treated the grid as a flat list would land on cells[2].
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cells[1 + 6]);

    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cells[1]);

    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
    fireEvent.keyDown(grid, { key: "Home" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("does not select the colour that arrow keys move onto", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    const grid = screen.getByTestId("c-palette");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="radio"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    // Selection-follows-focus is WRONG here: a pick closes the panel,
    // so it would be impossible to arrow past a colour without
    // committing to it. Nothing may be stored until a real activation.
    expect(screen.getByTestId("stored").textContent).toBe("null");
  });

  it("clamps at the row ends rather than wrapping to another row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("c"));
    const grid = screen.getByTestId("c-palette");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="radio"]'));
    cells[0]?.focus();
    // Wrapping would silently change ROW on a horizontal key, which is
    // disorienting in a grid where position carries meaning.
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[0]);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cells[0]);
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
    // The stored value is a PALETTE ref, so the custom form starts
    // collapsed and has to be opened — see the disclosure rule.
    fireEvent.click(screen.getByTestId("c-custom-toggle"));
    // "Start from Blue and nudge it" — each well seeds from the half
    // for ITS mode, not from whichever one the theme happens to be.
    expect(screen.getByTestId<HTMLInputElement>("c-custom-light").value)
      .toBe(BLUE?.light.toLowerCase());
    expect(screen.getByTestId<HTMLInputElement>("c-custom-dark").value)
      .toBe(BLUE?.dark.toLowerCase());
  });
});
