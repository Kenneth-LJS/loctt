// @vitest-environment jsdom
import type { EntityColor } from "@loctt/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabelsCell } from "../list/cells.tsx";
import { IconColorFields } from "./IconColorFields.tsx";
import { LABEL_PILL_CLASS, labelPillStyle } from "./labelPillStyle.ts";
import { NARROW_PX, SPECIMEN_W, ThemePreview } from "./ThemePreview.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

/**
 * Drives `useIsNarrow` (which reads `matchMedia`, falling back to
 * `innerWidth`) at a given viewport width. Stubbed rather than mocked
 * out: the breakpoint arithmetic is the behaviour under test, so the
 * real hook must run.
 */
function setViewport(width: number): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", (query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query);
    const max = m?.[1] !== undefined ? Number(m[1]) : 0;
    return {
      matches: width <= max,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

/** A palette colour whose two halves are genuinely different hexes. */
const PALETTE: EntityColor = { palette: "blue" };

describe("ThemePreview — per-mode resolution", () => {
  /**
   * The regression this catches is THE bug of this feature: a real
   * component dropped into a `.dark` island resolves its own hex
   * through `useColorMode()`, which reads the GLOBAL theme, so both
   * halves paint with the same colour and the dark half is a lie that
   * looks plausible. Asserting the two hexes DIFFER is the only thing
   * that distinguishes a working preview from that bug.
   */
  it("hands each half its own mode's hex, not the same one twice", () => {
    setViewport(1200);
    const seen: { hex: string | undefined; mode: string }[] = [];
    render(
      <ThemePreview
        color={PALETTE}
        testId="tp"
        render={(hex, mode) => {
          seen.push({ hex, mode });
          return <span data-testid={`spec-${mode}`}>{hex}</span>;
        }}
      />,
    );

    expect(seen.map(s => s.mode)).toEqual(["light", "dark"]);
    const light = seen[0]?.hex;
    const dark = seen[1]?.hex;
    expect(light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
    // The whole point. If these are equal, the preview is resolving
    // through one global mode and the dark half is fiction.
    expect(light).not.toBe(dark);

    expect(screen.getByTestId("spec-light").textContent).toBe(light);
    expect(screen.getByTestId("spec-dark").textContent).toBe(dark);
  });

  /**
   * The global theme must not reach the specimens at all. With the page
   * in LIGHT mode the dark half still gets the dark hex — which is what
   * makes the preview answer "both themes" rather than "the current one
   * twice".
   */
  it("resolves the dark half from dark while the page is light", () => {
    setViewport(1200);
    document.documentElement.classList.remove("dark");
    const seen: (string | undefined)[] = [];
    render(
      <ThemePreview color={PALETTE} testId="tp" render={hex => { seen.push(hex); return null; }} />,
    );
    const [light, dark] = seen;
    expect(light).not.toBe(dark);
    // And the dark cell really is a token island, not just a label.
    expect(screen.getByTestId("tp-dark").className).toContain("dark");
    expect(screen.getByTestId("tp-light").className).not.toContain("dark");
  });

  /**
   * The two halves must be SIBLINGS. There is no `.light` scope — light
   * is `:root` — so a light cell nested inside the dark one would still
   * render dark tokens, and the preview would show two dark halves.
   */
  it("renders the two cells as siblings, neither nested in the other", () => {
    setViewport(1200);
    render(<ThemePreview color={PALETTE} testId="tp" render={() => null} />);
    const light = screen.getByTestId("tp-light");
    const dark = screen.getByTestId("tp-dark");
    expect(dark.contains(light)).toBe(false);
    expect(light.contains(dark)).toBe(false);
    expect(light.parentElement).toBe(dark.parentElement);
  });

  /**
   * Both halves must paint the surface explicitly. The light cell has no
   * class to opt into, so without an explicit paint it would inherit the
   * dialog's surface — and beside a dark island that reads as broken.
   */
  it("paints both surfaces explicitly", () => {
    setViewport(1200);
    render(<ThemePreview color={PALETTE} testId="tp" render={() => null} />);
    expect(screen.getByTestId("tp-light").className).toContain("bg-bg-surface");
    expect(screen.getByTestId("tp-dark").className).toContain("bg-bg-surface");
  });

  it("degrades a colour that does not resolve to the neutral fallback", () => {
    setViewport(1200);
    const seen: (string | undefined)[] = [];
    render(
      <ThemePreview
        color={{ palette: "no-such-colour" } as EntityColor}
        testId="tp"
        render={hex => { seen.push(hex); return null; }}
      />,
    );
    expect(seen).toEqual([undefined, undefined]);
  });
});

describe("ThemePreview — layout derived from width", () => {
  it("lays the cells in a row above the breakpoint", () => {
    setViewport(NARROW_PX);
    render(<ThemePreview color={PALETTE} testId="tp" render={() => null} />);
    const box = screen.getByTestId("tp");
    expect(box.className).toContain("flex-row");
    expect(box.className).not.toContain("flex-col");
  });

  it("stacks the cells below the breakpoint", () => {
    setViewport(NARROW_PX - 1);
    render(<ThemePreview color={PALETTE} testId="tp" render={() => null} />);
    const box = screen.getByTestId("tp");
    expect(box.className).toContain("flex-col");
    expect(box.className).not.toContain("flex-row");
  });

  /**
   * Both specimens must be the SAME fixed width, or the two renderings
   * are not comparable — a pill that wraps in one box and not the other
   * reports a difference about the box, not the colour. And the row must
   * actually fit the narrowest host it is used in.
   */
  it("gives both cells the same fixed width, and the row fits a 375px sheet", () => {
    setViewport(1200);
    render(<ThemePreview color={PALETTE} testId="tp" render={() => null} />);
    expect(screen.getByTestId("tp-light").style.width).toBe(`${SPECIMEN_W}px`);
    expect(screen.getByTestId("tp-dark").style.width).toBe(`${SPECIMEN_W}px`);
    // 375px viewport − Sheet's `p-4` on both sides = 343px of content.
    const SHEET_CONTENT_AT_375 = 375 - 16 * 2;
    expect(SPECIMEN_W * 2 + 8).toBeLessThanOrEqual(SHEET_CONTENT_AT_375);
  });
});

describe("ThemePreview — accessibility", () => {
  it("labels the container once and hides the specimens", () => {
    setViewport(1200);
    render(
      <ThemePreview
        color={PALETTE}
        testId="tp"
        ariaLabel="Label colour preview"
        render={() => <span>Bug</span>}
      />,
    );
    expect(screen.getByTestId("tp").getAttribute("aria-label")).toBe("Label colour preview");
    // The specimen text must not be announced twice — the picker
    // trigger already names the chosen colour.
    const hidden = screen.getByTestId("tp-light").querySelector("[aria-hidden='true']");
    expect(hidden).not.toBeNull();
    expect(hidden?.textContent).toContain("Bug");
  });
});

describe("IconColorFields — the preview slot", () => {
  function renderFields(opts: {
    icon?: string | undefined;
    color?: EntityColor | undefined;
    withPreview?: boolean;
  }) {
    return render(
      <IconColorFields
        icon={opts.icon}
        onIconChange={() => {}}
        color={opts.color}
        onColorChange={() => {}}
        iconTestId="f-icon"
        iconListTestId="f-icon-list"
        iconSearchTestId="f-icon-search"
        iconClearTestId="f-icon-clear"
        colorTestId="f-color-picker"
        colorAliasTestId="f-color"
        noun="view"
        {...(opts.withPreview === false
          ? {}
          : {
              preview: (
                <ThemePreview
                  color={opts.color}
                  testId="f-preview"
                  render={hex => <span data-testid="glyph">{hex ?? "none"}</span>}
                />
              ),
            })}
      />,
    );
  }

  it("renders nothing extra when no preview is passed", () => {
    setViewport(1200);
    renderFields({ color: PALETTE, withPreview: false });
    expect(screen.queryByTestId("f-preview")).toBeNull();
  });

  /**
   * Ken's override of the review (2026-09-23, "if emoji case, just show
   * emoji with bg"): for an emoji the colour control goes inert, but the
   * preview STILL renders. The emoji does not change between the halves
   * — the BACKGROUNDS do — so the preview still answers "is this legible
   * in both themes", which is the only question it exists to answer.
   *
   * The regression: a `!colorInert &&` guard on the slot, which is the
   * obvious-looking thing to write and would silently drop the preview
   * for exactly the icons whose legibility is least guaranteed.
   */
  it("renders the preview for an emoji while the colour control stays inert", () => {
    setViewport(1200);
    renderFields({ icon: "🎯", color: PALETTE });

    // Preview present, both halves.
    expect(screen.getByTestId("f-preview")).not.toBeNull();
    expect(screen.getByTestId("f-preview-light")).not.toBeNull();
    expect(screen.getByTestId("f-preview-dark")).not.toBeNull();

    // And the colour control really is inert in that same state.
    expect(screen.getByTestId("f-color-picker").getAttribute("disabled")).not.toBeNull();
  });

  it("renders the preview for a Lucide icon, with the colour control live", () => {
    setViewport(1200);
    renderFields({ icon: "circle-check", color: PALETTE });
    expect(screen.getByTestId("f-preview")).not.toBeNull();
    expect(screen.getByTestId("f-color-picker").getAttribute("disabled")).toBeNull();
  });
});

describe("labelPillStyle — shared with the real pill", () => {
  /**
   * The preview's claim is that it shows the REAL pill. That claim is
   * only true while both go through this one function — a replica that
   * drifts reports a legibility the list does not have.
   */
  it("derives three values from the colour, not the colour itself", () => {
    const s = labelPillStyle("#3B82F6");
    expect(s.background).toBe("#3B82F622");
    expect(s.borderColor).toBe("#3B82F666");
    expect(s.color).toBe("#3B82F6");
    expect(LABEL_PILL_CLASS).toContain("rounded");
  });

  it("hands back to the theme's text colour at the ends of the luma range", () => {
    // Too pale to read on the 13% wash over a light surface.
    expect(labelPillStyle("#FFFFEE").color).toBe("var(--text-primary)");
    // Too dark on a dark one.
    expect(labelPillStyle("#050510").color).toBe("var(--text-primary)");
  });

  it("falls back to neutral tokens when the colour did not resolve", () => {
    const s = labelPillStyle(undefined);
    expect(s.background).toBe("var(--bg-muted)");
    expect(s.color).toBe("var(--text-secondary)");
    expect(s.borderColor).toBeUndefined();
  });
});

/**
 * The preview's claim — "this is the real pill" — is only true while
 * `list/cells.tsx` actually ROUTES THROUGH the shared function. Until
 * today nothing asserted the pill's colour styling at all: deleting the
 * pill's entire inline style left all 352 `list/` tests green. That gap
 * matters more now, because the same function feeds two surfaces, so a
 * regression here would quietly make the preview a liar rather than
 * just making one pill grey.
 */
describe("the real pill routes through the shared style", () => {
  it("paints a list pill with exactly labelPillStyle's derived values", () => {
    // Compared against a REFERENCE element carrying `labelPillStyle`
    // directly, not against the hex literals: jsdom re-serialises
    // `#3B82F622` as `rgba(...)`, so a literal comparison would be
    // asserting jsdom's serialiser rather than the wiring.
    render(
      <>
        <LabelsCell labels={[{ id: "l1", name: "alpha", color: "#3B82F6" }]} />
        <span data-testid="reference" style={labelPillStyle("#3B82F6")} />
      </>,
    );
    const pill = screen.getByText("alpha").closest("[style]") as HTMLElement;
    const reference = screen.getByTestId("reference");
    expect(pill.style.background).toBe(reference.style.background);
    expect(pill.style.borderColor).toBe(reference.style.borderColor);
    expect(pill.style.color).toBe(reference.style.color);
    // And it is genuinely the derived wash, not the raw colour.
    expect(pill.style.background).not.toBe(pill.style.color);
  });
});
