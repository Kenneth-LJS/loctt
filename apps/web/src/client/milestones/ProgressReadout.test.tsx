// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Progress } from "./model.ts";
import { progressState } from "./model.ts";
import { ProgressReadout } from "./ProgressReadout.tsx";

/**
 * ProgressReadout: the two opt-in additions L4 needed, verified without
 * disturbing the milestone/sprint defaults.
 *
 *  1. The bar's `aria-label` is a prop. It used to be the literal
 *     "Milestone progress" (known-gaps), which a child-progress caller
 *     would announce wrongly. The default is unchanged, so the existing
 *     callers are behaviour-preserving.
 *  2. A `segmented` fill draws done / active / rest, but only when the
 *     readout also carries an `activeFill` — the milestone readout has
 *     none and keeps its single fill.
 */

afterEach(cleanup);

function counted(over: Partial<Progress> = {}): Progress {
  const base: Progress = { done: 2, total: 4, discarded: 0, fraction: 0.5 };
  return { ...base, ...over };
}

describe("ProgressReadout label", () => {
  it("defaults the bar's accessible name to Milestone progress", () => {
    render(
      <ProgressReadout
        readout={progressState(counted())}
        idPrefix="m"
        milestoneName="Alpha"
      />,
    );
    expect(screen.getByTestId("m-bar").getAttribute("aria-label")).toBe(
      "Milestone progress",
    );
  });

  it("uses the label prop when given, so a child caller does not say Milestone", () => {
    // Red-proof: with the old hard-coded label this reads "Milestone
    // progress" regardless of the prop, and this assertion fails.
    render(
      <ProgressReadout
        readout={progressState(counted())}
        idPrefix="child-progress"
        milestoneName="child tasks"
        label="Child progress"
      />,
    );
    const bar = screen.getByTestId("child-progress-bar");
    expect(bar.getAttribute("aria-label")).toBe("Child progress");
  });
});

describe("ProgressReadout segmented fill", () => {
  it("draws a single fill and no active segment for a milestone-shaped readout", () => {
    // No `active` on the source Progress → activeFill undefined → single
    // fill, even if a caller passed `segmented`. This is what keeps the
    // milestone/sprint bars unchanged.
    render(
      <ProgressReadout
        readout={progressState(counted())}
        idPrefix="m"
        milestoneName="Alpha"
        segmented
      />,
    );
    expect(screen.getByTestId("m-bar-fill")).toBeTruthy();
    expect(screen.queryByTestId("m-bar-active")).toBeNull();
  });

  it("draws done and active segments when segmented and active is present", () => {
    // 2 done, 1 active of 4. Red-proof: without the `segmented` branch
    // (or without threading activeFill through progressState), the
    // active segment element is absent and this fails.
    render(
      <ProgressReadout
        readout={progressState(counted({ done: 2, active: 1, total: 4, fraction: 0.5 }))}
        idPrefix="c"
        milestoneName="child tasks"
        label="Child progress"
        segmented
      />,
    );
    const done = screen.getByTestId("c-bar-fill");
    const active = screen.getByTestId("c-bar-active");
    expect(done).toBeTruthy();
    expect(active).toBeTruthy();
    // Widths reflect the shares: done 2/4 = 50%, active 1/4 = 25%.
    expect(done.getAttribute("style")).toContain("width: 50%");
    expect(active.getAttribute("style")).toContain("width: 25%");
  });

  it("does not draw segments when active is present but segmented is off", () => {
    // The active count alone must not change the milestone bar: segments
    // are opt-in.
    render(
      <ProgressReadout
        readout={progressState(counted({ done: 2, active: 1, total: 4, fraction: 0.5 }))}
        idPrefix="m"
        milestoneName="Alpha"
      />,
    );
    expect(screen.queryByTestId("m-bar-active")).toBeNull();
  });
});
