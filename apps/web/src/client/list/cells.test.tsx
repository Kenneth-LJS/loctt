// @vitest-environment jsdom
import type { StatusDef, UserProfile } from "@loctt/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WireHealth } from "../health/fieldHealth.ts";
import { AssigneeCell, PriorityCell, StatusBadge, TypeBadge } from "./cells.tsx";

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
