// @vitest-environment jsdom
import type { LabelDef, PriorityDef, StatusDef, TaskTypeDef, UserProfile } from "@loctt/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WireHealth } from "../health/fieldHealth.ts";
import { labelPillStyle } from "../ui/labelPillStyle.ts";
import { AssigneeCell, LabelsCell, PriorityCell, StatusBadge, TypeBadge } from "./cells.tsx";

/**
 * AssigneeCell degradation (PRU-25). The same cell renders both the
 * assignee and reporter columns, so its three states — live user,
 * archived user, dangling reference — are covered once here.
 *
 * The dangling case is the K22 carve-out: a reference to a user the
 * tracker no longer knows (a hand-edited users file, K21) shows the
 * truncated ULID plus "(deleted user)", not blank, "undefined", the
 * bare ULID, or the old "unknown user".
 */

const LIVE: UserProfile = {
  id: "01USERKEN00000000000000000",
  name: "Ken Loh",
  timezone: "UTC",
};

const ARCHIVED: UserProfile = {
  id: "01USERARCH0000000000000000",
  name: "Dana Old",
  timezone: "UTC",
  archived: true,
};

/** A ULID no user resolves to — the dangling state PRU-25 describes. */
const DANGLING_ULID = "01DAVEGONE0000000000A1B2C6";

afterEach(cleanup);

describe("AssigneeCell", () => {
  // @verifies PRU-25
  // @verifies DEG-14
  it("degrades a dangling user reference to truncated-ULID + (deleted user)", () => {
    render(<AssigneeCell user={undefined} raw={DANGLING_ULID} />);
    const short = DANGLING_ULID.slice(-6);

    // The truncated ULID is shown (K22: diagnostic in an error state)…
    expect(screen.getByText(short)).toBeTruthy();
    // …paired with the degraded label.
    expect(screen.getByText(/\(deleted user\)/)).toBeTruthy();

    // Positive controls for what the cell must NOT be:
    // not the old vocabulary, not the raw full ULID, not blank.
    expect(screen.queryByText("unknown user")).toBeNull();
    expect(screen.queryByText(DANGLING_ULID)).toBeNull(); // full id never shown
    expect(screen.queryByText("undefined")).toBeNull();
  });

  // @verifies PRU-25
  it("shows only the truncated tail, never the whole ULID", () => {
    const { container } = render(<AssigneeCell user={undefined} raw={DANGLING_ULID} />);
    // The visible text is the 6-char tail, not the 26-char id — a guard
    // that a future 'show more of the id' change cannot silently pass.
    expect(container.textContent).toContain(DANGLING_ULID.slice(-6));
    expect(container.textContent).not.toContain(DANGLING_ULID.slice(0, 20));
  });

  // @verifies PRU-25
  it("renders a live user by name with no degraded marker", () => {
    render(<AssigneeCell user={LIVE} raw={LIVE.id} />);
    expect(screen.getByText("Ken")).toBeTruthy();
    // The deleted-user carve-out must never leak onto healthy content.
    expect(screen.queryByText(/\(deleted user\)/)).toBeNull();
    expect(screen.queryByText(LIVE.id.slice(-6))).toBeNull();
  });

  // @verifies PRU-25
  it("renders an archived user by name + (archived), not the deleted form", () => {
    render(<AssigneeCell user={ARCHIVED} raw={ARCHIVED.id} />);
    expect(screen.getByText(/Dana/)).toBeTruthy();
    expect(screen.getByText(/\(archived\)/)).toBeTruthy();
    expect(screen.queryByText(/\(deleted user\)/)).toBeNull();
  });

  it("renders a dash when the reference is unset", () => {
    const { container } = render(<AssigneeCell user={undefined} raw={undefined} />);
    expect(container.textContent).not.toContain("deleted user");
  });
});

/**
 * Per-field corruption markers (A137 / A137.1, corruption-sweep S3).
 *
 * A degraded field must be VISIBLE as needing attention on the list —
 * "surface it, don't hide it" — matching the ⚠ + "(broken)" precedent
 * that Sidebar/SavedViewsPanel use for a broken saved view. Two shapes:
 *
 * - A whole-field-corrupt (intrinsic) fault lifts the value out of
 *   `frontmatter` into `health`, so the cell has no def/raw: it renders
 *   the `rawText` + marker rather than a dash that would hide the fault.
 * - A co-existing (element/extrinsic) fault leaves the value in place:
 *   the cell renders the value AND the marker.
 */
const STATUS_DEF: StatusDef = { key: "in_progress", label: "In progress", category: "active" };

function health(field: string, over: Partial<WireHealth> = {}): WireHealth {
  return {
    field,
    kind: "wrong_type",
    rawText: "[1, 2]",
    error: `${field} must be a string`,
    repair: "set_or_remove",
    ...over,
  };
}

describe("cell corruption markers", () => {
  // @verifies A137.1 (whole-field intrinsic fault)
  it("StatusBadge with no value but a health finding shows the raw text + (broken), not a dash", () => {
    const { container } = render(
      <StatusBadge def={undefined} raw={undefined} health={health("status", { rawText: "42" })} />,
    );
    // The raw stored value is preserved and shown (K27)…
    expect(container.textContent).toContain("42");
    // …with the broken marker, and NOT the plain em-dash.
    expect(screen.getByText(/\(broken\)/)).toBeTruthy();
    expect(container.querySelector('[data-testid="field-health-status"]')).toBeTruthy();
    expect(container.textContent).not.toContain("—");
  });

  // @verifies A137.1 (co-existing value + element fault)
  it("StatusBadge with a valid value AND a health finding shows the value and the marker", () => {
    const { container } = render(
      <StatusBadge def={STATUS_DEF} raw="in_progress" health={health("status")} />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText(/\(broken\)/)).toBeTruthy();
    expect(container.querySelector('[data-testid="field-health-status"]')).toBeTruthy();
  });

  // @verifies "no health → unchanged" (board reuses these cells with no health)
  it("a clean cell (no health) renders no broken marker", () => {
    const { container } = render(<StatusBadge def={STATUS_DEF} raw="in_progress" />);
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(container.textContent).not.toContain("(broken)");
    expect(container.querySelector('[data-testid^="field-health-"]')).toBeNull();
  });

  it("PriorityCell and TypeBadge with no value but a health finding show the raw + (broken)", () => {
    const p = render(<PriorityCell def={undefined} raw={undefined} health={health("priority", { rawText: "99" })} />);
    expect(p.container.textContent).toContain("99");
    expect(within(p.container).getByText(/\(broken\)/)).toBeTruthy();

    const t = render(<TypeBadge def={undefined} raw={undefined} health={health("task_type", { rawText: "true" })} />);
    expect(t.container.textContent).toContain("true");
    expect(within(t.container).getByText(/\(broken\)/)).toBeTruthy();
  });

  it("AssigneeCell with a resolved user AND a health finding shows the name and the marker", () => {
    const { container } = render(
      <AssigneeCell user={LIVE} raw={LIVE.id} health={health("assignee")} />,
    );
    expect(screen.getByText("Ken")).toBeTruthy();
    expect(within(container).getByText(/\(broken\)/)).toBeTruthy();
  });
});

/**
 * K103 stage 2 — the list cells paint a RESOLVED colour.
 *
 * `cells.tsx` used to guard its CSS with a local hex regex and to hand
 * `def.color` straight to a style object. Both were correct while a
 * colour was a string and both break silently on the three-shape
 * union: the regex rejects every palette and per-mode colour to
 * `undefined` (the tint disappears), and the raw hand-off stringifies
 * an object to `[object Object]` (CSS discards it, so the tint
 * disappears too). Neither throws, and neither shows up in a
 * typecheck once inference has widened — which is why these assert on
 * the painted style rather than on the component rendering at all.
 */
describe("K103 — colour resolution in list cells", () => {
  const priority = (color: PriorityDef["color"]): PriorityDef =>
    ({ key: "high", label: "High", ...(color === undefined ? {} : { color }) }) as PriorityDef;

  /** The dot's inline background, as the DOM actually holds it. */
  function dotBackground(el: HTMLElement): string {
    const dot = el.querySelector("span > span");
    return (dot as HTMLElement | null)?.style.background ?? "";
  }

  it("paints a PALETTE priority colour, rather than dropping it", () => {
    const { container } = render(<PriorityCell def={priority({ palette: "red" })} raw="high" />);
    // A hex actually reached CSS. The regex this replaced matched
    // nothing here, so the dot fell back to the key-based class and the
    // configured colour was silently lost.
    expect(dotBackground(container)).not.toBe("");
    expect(dotBackground(container)).not.toContain("object Object");
  });

  it("paints a PER-MODE priority colour with the half for the active theme", () => {
    const { container } = render(
      <PriorityCell def={priority({ light: "#102030", dark: "#a0b0c0" })} raw="high" />,
    );
    // jsdom has no `matchMedia`, so `useTheme` resolves to light — the
    // light half is what must paint, not the object and not the dark one.
    expect(dotBackground(container)).toBe("rgb(16, 32, 48)");
  });

  it("paints a TYPE badge's palette colour instead of [object Object]", () => {
    const { container } = render(
      <TypeBadge def={{ key: "bug", label: "Bug", color: { palette: "blue" } } as TaskTypeDef} raw="bug" />,
    );
    const badge = container.querySelector("span") as HTMLElement;
    expect(badge.style.color).not.toBe("");
    expect(badge.style.color).not.toContain("object Object");
    expect(badge.style.borderColor).toBe(badge.style.color);
  });

  it("falls back to the key-based dot when a palette id is unknown", () => {
    const { container } = render(<PriorityCell def={priority({ palette: "nosuch" })} raw="high" />);
    // Field-local degrade: no inline colour, and the key-based class
    // still tints, so the row is not left blank over one bad reference.
    expect(dotBackground(container)).toBe("");
    expect((container.querySelector("span > span") as HTMLElement).className)
      .toContain("bg-priority-high");
  });
});

/**
 * B15: `LabelsCell` had no colour assertion, unlike its priority/type
 * siblings above — `labelPillStyle` (shared with the settings preview,
 * `ui/labelPillStyle.ts`) is exactly as prone to the K103 silent-failure
 * class (an unresolved `EntityColor` stringifying to `[object Object]`,
 * which CSS discards) as `PriorityCell`/`TypeBadge` were, and nothing
 * here pinned it.
 */
describe("K103 — colour resolution in LabelsCell", () => {
  const label = (id: string, name: string, color?: LabelDef["color"]): LabelDef =>
    ({ id, name, ...(color === undefined ? {} : { color }) }) as LabelDef;

  /**
   * The rendered pill for a given label name — the outer `Pill` element
   * `labelPillStyle` is applied to, identified by its `title` (set to
   * the label's `name`), not the innermost truncating `<span>` that
   * wraps the visible text (which would otherwise satisfy a bare
   * `closest("span")` against itself).
   */
  function pillFor(container: HTMLElement, name: string): HTMLElement {
    return within(container).getByText(name).closest(`[title="${name}"]`) as HTMLElement;
  }

  it("paints a PALETTE label colour via labelPillStyle, rather than dropping it", () => {
    const { container } = render(
      <LabelsCell labels={[label("l1", "Urgent", { palette: "red" })]} />,
    );
    const pill = pillFor(container, "Urgent");
    // A hex actually reached CSS, derived through the same
    // `labelPillStyle` the preview uses — not a hand-rolled regex that
    // would reject this shape to undefined, and not `[object Object]`.
    expect(pill.style.background).not.toBe("");
    expect(pill.style.background).not.toContain("object Object");
    // Not merely "some colour" — must specifically NOT be the neutral
    // fallback that a dropped/unresolved reference would paint instead
    // (the exact shape of the K103 regression: a resolvable colour
    // silently falling through to the "no colour" branch).
    expect(pill.style.background).not.toBe(labelPillStyle(undefined).background);
  });

  it("paints a PER-MODE label colour with the half for the active theme", () => {
    const resolvedHex = "#102030";
    const { container } = render(
      <LabelsCell labels={[label("l1", "Urgent", { light: resolvedHex, dark: "#a0b0c0" })]} />,
    );
    const pill = pillFor(container, "Urgent");
    // jsdom has no `matchMedia`, so `useTheme` resolves to light — the
    // light half must paint, matching `labelPillStyle`'s own derivation
    // exactly (background wash, border, and computed text colour), not
    // just "some colour appeared". Both sides go through a real DOM
    // element's `style` so jsdom's own 8-digit-hex→rgba() normalization
    // (`#10203022` reads back as `rgba(16, 32, 48, 0.133)`) applies
    // identically on both — comparing the raw hex string against the
    // rendered pill's normalized form would fail for a reason that has
    // nothing to do with the component.
    const expected = labelPillStyle(resolvedHex);
    const probe = document.createElement("span");
    probe.style.background = expected.background as string;
    probe.style.borderColor = expected.borderColor as string;
    probe.style.color = expected.color as string;
    expect(pill.style.background).toBe(probe.style.background);
    expect(pill.style.borderColor).toBe(probe.style.borderColor);
    expect(pill.style.color).toBe(probe.style.color);
  });

  it("falls back to the neutral pill when a palette id is unknown", () => {
    const { container } = render(
      <LabelsCell labels={[label("l1", "Urgent", { palette: "nosuch" })]} />,
    );
    const pill = pillFor(container, "Urgent");
    // Field-local degrade (MSL-22): an unresolved reference paints the
    // documented neutral fallback, not an unstyled or blank pill.
    const expected = labelPillStyle(undefined);
    expect(pill.style.background).toBe(expected.background);
    expect(pill.style.color).toBe(expected.color);
  });
});
