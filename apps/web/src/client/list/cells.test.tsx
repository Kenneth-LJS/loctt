// @vitest-environment jsdom
import type { UserProfile } from "@loctt/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssigneeCell } from "./cells.tsx";

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
