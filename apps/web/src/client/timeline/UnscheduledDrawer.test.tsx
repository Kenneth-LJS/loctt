// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DateProblem, TimelineRow, TimelineTask } from "./rows.ts";
import { UnscheduledDrawer } from "./UnscheduledDrawer.tsx";

afterEach(cleanup);

function row(n: number, problem: DateProblem): TimelineRow {
  const task = {
    id: `01U${String(n).padStart(23, "0")}`,
    key: `U-${String(n)}`,
    title: `Undated ${String(n)}`,
  } as unknown as TimelineTask;
  return { task, scheduled: false, problem };
}

describe("UnscheduledDrawer (timeline redesign)", () => {
  // @verifies TML-51
  it("renders nothing when there are no unscheduled rows", () => {
    const { container } = render(
      <UnscheduledDrawer rows={[]} onOpenTask={() => {}} isNarrow={false} />,
    );
    expect(container.querySelector('[data-testid="timeline-unscheduled"]')).toBeNull();
  });

  // @verifies TML-51
  it("is collapsed by default: header + count show, rows do not", () => {
    const rows = [
      row(1, { kind: "undated" }),
      row(2, { kind: "open_due", due: "2026-03-06" }),
    ];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow={false} />,
    );
    // The header strip and count are always visible.
    expect(container.querySelector('[data-testid="timeline-unscheduled"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="timeline-unscheduled-count"]')?.textContent,
    ).toBe("(2)");
    // Collapsed → no rows in the DOM.
    expect(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="timeline-unscheduled-toggle"]')
      ?.getAttribute("aria-expanded")).toBe("false");
  });

  // @verifies TML-52
  it("expands to reveal the rows and their reason chips when the header is clicked", () => {
    const rows = [row(1, { kind: "open_due", due: "2026-03-06" })];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow={false} />,
    );
    fireEvent.click(container.querySelector('[data-testid="timeline-unscheduled-toggle"]') as Element);
    expect(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]')).not.toBeNull();
    const reason = container.querySelector('[data-testid="timeline-unscheduled-reason-U-1"]');
    expect(reason?.textContent).toContain("No start date");
  });

  // @verifies TML-51
  it("shows a breakdown by problem kind, with the broken bucket in danger colour", () => {
    const rows = [
      row(1, { kind: "undated" }),
      row(2, { kind: "undated" }),
      row(3, { kind: "open_due", due: "2026-03-06" }),
      row(4, { kind: "corrupt", field: "start_date", rawText: "next tuesday" }),
    ];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow={false} />,
    );
    const header = container.querySelector('[data-testid="timeline-unscheduled-toggle"]');
    expect(header?.textContent).toContain("2 undated");
    expect(header?.textContent).toContain("1 due-only");
    expect(header?.textContent).toContain("1 corrupt");
    // The corrupt/invalid count carries the danger token.
    const danger = header?.querySelector(".text-danger-fg");
    expect(danger?.textContent).toBe("1 corrupt");
  });

  // @verifies TML-54
  it("auto-expands once when initiallyExpanded (TML-41: no dated tasks)", () => {
    const rows = [row(1, { kind: "undated" })];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow={false} initiallyExpanded />,
    );
    // Row visible without a click.
    expect(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]')).not.toBeNull();
    // ...but still user-collapsible.
    fireEvent.click(container.querySelector('[data-testid="timeline-unscheduled-toggle"]') as Element);
    expect(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]')).toBeNull();
  });

  // @verifies TML-52
  it("clicking a row opens the task", () => {
    const onOpenTask = vi.fn();
    const rows = [row(1, { kind: "undated" })];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={onOpenTask} isNarrow={false} initiallyExpanded />,
    );
    fireEvent.click(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]') as Element);
    expect(onOpenTask).toHaveBeenCalledWith("U-1");
  });

  // @verifies TML-53
  it("on a phone the expanded drawer opens as its own Sheet, not the desktop scroll body", () => {
    const rows = [row(1, { kind: "undated" })];
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow initiallyExpanded />,
    );
    // The Sheet renders instead of the capped desktop body.
    expect(container.querySelector('[data-testid="timeline-unscheduled-sheet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="timeline-unscheduled-body"]')).toBeNull();
    // The row is still reachable inside it.
    expect(container.querySelector('[data-testid="timeline-unscheduled-row-U-1"]')).not.toBeNull();
  });

  // @verifies TML-53
  it("the desktop expanded body caps its own height so it cannot squeeze the chart", () => {
    // Red-prove: with 200 unscheduled rows the body scrolls within a
    // max-height rather than growing unbounded. If the max-h cap were
    // removed the class would be gone and this assertion would fail.
    const rows = Array.from({ length: 200 }, (_v, i) => row(i, { kind: "undated" }));
    const { container } = render(
      <UnscheduledDrawer rows={rows} onOpenTask={() => {}} isNarrow={false} initiallyExpanded />,
    );
    const body = container.querySelector('[data-testid="timeline-unscheduled-body"]');
    expect(body).not.toBeNull();
    expect(body?.className).toContain("max-h-[40vh]");
    expect(body?.className).toContain("overflow-y-auto");
  });
});
