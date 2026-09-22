// @vitest-environment jsdom
import type { EntityColor } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IconColorFields } from "./IconColorFields.tsx";

afterEach(() => { cleanup(); });

/**
 * K104 / A279 — the icon↔colour coupling rule.
 *
 * A279 names this "the kind of state transition that gets built wrong",
 * so the icon → emoji → icon round trip is asserted explicitly: the
 * colour must come back, not have been cleared on the way through.
 */

function Harness({
  initialIcon,
  initialColor,
}: {
  readonly initialIcon?: string | undefined;
  readonly initialColor?: EntityColor | undefined;
}) {
  const [icon, setIcon] = useState<string | undefined>(initialIcon);
  const [color, setColor] = useState<EntityColor | undefined>(initialColor);
  return (
    <div>
      <IconColorFields
        icon={icon}
        onIconChange={setIcon}
        color={color}
        onColorChange={setColor}
        iconTestId="e-icon"
        iconListTestId="e-icon-list"
        iconSearchTestId="e-icon-search"
        iconClearTestId="e-icon-clear"
        colorTestId="e-color-picker"
        colorAliasTestId="e-color"
        noun="status"
      />
      <output data-testid="stored-color">{JSON.stringify(color) ?? "(none)"}</output>
    </div>
  );
}

/**
 * Picks an icon through the portalled grid, switching to the Emoji tab
 * when the target is one (the panel opens on Icons for a Lucide value).
 */
function pickIcon(id: string, tab: "icons" | "emoji" = "icons"): void {
  fireEvent.click(screen.getByTestId("e-icon"));
  // The panel opens on the tab matching the CURRENT value, so always
  // click the one we want rather than assuming where it landed.
  fireEvent.click(screen.getByTestId(`e-icon-list-tab-${tab}`));
  fireEvent.click(screen.getByTestId(`icon-option-${id}`));
}

describe("IconColorFields — the emoji/colour rule", () => {
  it("disables the colour control with an inline reason once the icon is an emoji", () => {
    render(<Harness initialIcon="flag" initialColor={{ palette: "blue" }} />);
    // A Lucide icon takes a colour, so the control is live.
    expect(screen.getByTestId("e-color-picker").hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("e-color-picker-disabled-reason")).toBeNull();

    pickIcon("🚀", "emoji");

    expect(screen.getByTestId("e-color-picker").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("e-color-picker-disabled-reason").textContent)
      .toContain("carries its own colour");
  });

  it("PRESERVES the colour inert: icon → emoji → icon restores the same colour", () => {
    // A279, on P-11: clearing on the switch discards a deliberate choice
    // and forces the user to re-pick. This is the assertion that an
    // implementation which clears on disable fails.
    render(<Harness initialIcon="flag" initialColor={{ palette: "blue" }} />);
    expect(screen.getByTestId("stored-color").textContent).toBe('{"palette":"blue"}');

    // → emoji. The stored colour must be untouched, not cleared.
    pickIcon("🚀", "emoji");
    expect(screen.getByTestId("stored-color").textContent).toBe('{"palette":"blue"}');
    // …and it is still VISIBLE on the inert control, so what is
    // preserved is not preserved invisibly.
    expect(screen.getByTestId("e-color-picker").getAttribute("data-value")).toBe("blue");

    // → back to a Lucide icon. The same colour is live again.
    pickIcon("star");
    expect(screen.getByTestId("stored-color").textContent).toBe('{"palette":"blue"}');
    expect(screen.getByTestId("e-color-picker").hasAttribute("disabled")).toBe(false);
  });

  it("closes the hex alias back door while the colour is inert", () => {
    // The alias is the control the settings tests type into. If it
    // stayed live it would write the very colour the visible control
    // refuses — a disabled state with a hole in it.
    render(<Harness initialIcon="🚀" initialColor={{ palette: "blue" }} />);
    expect(screen.getByTestId<HTMLInputElement>("e-color").disabled).toBe(true);
  });

  it("leaves the colour live when no icon is set at all", () => {
    // A colourless-icon entity with a tint is ordinary; disabling the
    // control just because the icon is empty would strand it.
    render(<Harness />);
    expect(screen.getByTestId("e-color-picker").hasAttribute("disabled")).toBe(false);
  });
});
