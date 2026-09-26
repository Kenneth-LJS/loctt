// @vitest-environment jsdom
import type {
  CardLayoutField,
  TaskFrontmatterPublic,
} from "@loctt/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WireHealth } from "../health/fieldHealth.ts";
import { buildLookups } from "../list/lookups.ts";
import { BoardCard } from "./BoardCard.tsx";

/**
 * Phase-7B S1: the board card must SHOW a corrupt task rather than
 * hiding the fault (A137 / A137.1). Two things the pre-sweep card got
 * wrong, both proven here:
 *
 *  - An untitled task (title absent — either never set or lifted whole
 *    into `health`) rendered a BLANK title. K26: it must fall back to
 *    the key, never blank, so the card is still findable.
 *  - A corrupt field (a `health` entry for it) rendered as if clean:
 *    no ⚠, and for a whole-field-corrupt value the board's dense
 *    "absent → render nothing" shortcut dropped it silently. The shared
 *    list cells already carry the ⚠/"(broken)" markers; the card must
 *    PASS health to them, and handle the title's own marker.
 *
 * The card consumes S3's list cells (their `health` prop) rather than
 * reinventing a marker — asserted by the cells' own `field-health-*`
 * testids showing up on a board card.
 */

const LOOKUPS = buildLookups({
  projects: [],
  users: [],
  labels: [],
  workflow: {
    statuses: [{ key: "todo", label: "To do", category: "pending" }],
    priorities: [],
    task_types: [],
  } as never,
});

const MILESTONES: readonly { id: string; name: string }[] = [];
const SPRINTS: readonly { id: string; name: string }[] = [];

function health(field: string, over: Partial<WireHealth> = {}): WireHealth {
  return {
    field,
    kind: "wrong_type",
    rawText: "42",
    error: `${field} is corrupt`,
    repair: "set_or_remove",
    ...over,
  };
}

function renderCard(
  task: TaskFrontmatterPublic,
  opts: {
    health?: readonly WireHealth[];
    layout?: readonly CardLayoutField[];
    badges?: import("./relationshipBadges.ts").BoardCardBadges;
  } = {},
) {
  return render(
    <BoardCard
      task={task}
      badges={opts.badges}
      health={opts.health}
      layout={opts.layout ?? []}
      lookups={LOOKUPS}
      milestones={MILESTONES}
      sprints={SPRINTS}
      today="2026-09-06"
      onOpen={() => undefined}
      onFilterLabel={() => undefined}
    />,
  );
}

afterEach(cleanup);

describe("BoardCard title fallback + marker (K26 / A137.1)", () => {
  // @verifies K26
  // @verifies DEG-8
  it("falls back to the key for an untitled task, never a blank title", () => {
    const task: TaskFrontmatterPublic = { id: "01AAA", key: "WEB-7" };
    const { container } = renderCard(task);

    // The key is rendered as the title — the card is findable, not blank.
    const card = container.querySelector('[data-testid="board-card-WEB-7"]');
    expect(card).toBeTruthy();
    // The title line shows the key. (The key also appears in the `key`
    // layout field, but that is not in this layout, so this is the title.)
    expect(within(card as HTMLElement).getByText("WEB-7")).toBeTruthy();
    // Never a blank title node.
    expect((card as HTMLElement).textContent).toContain("WEB-7");
  });

  // @verifies A137.1
  it("marks a corrupt title (lifted into health) with ⚠ and shows the key", () => {
    const task: TaskFrontmatterPublic = { id: "01BBB", key: "WEB-8" };
    const { container } = renderCard(task, {
      health: [health("title", { error: "title is not a string" })],
    });

    // Key shown in place of the corrupt title…
    expect(screen.getByText("WEB-8")).toBeTruthy();
    // …with the ⚠ attention marker beside it.
    expect(container.textContent).toContain("⚠");
  });

  it("a healthy titled card shows the title and NO marker", () => {
    const task: TaskFrontmatterPublic = {
      id: "01CCC",
      key: "WEB-9",
      title: "Real title",
    };
    const { container } = renderCard(task);
    expect(screen.getByText("Real title")).toBeTruthy();
    // No corruption glyph on a clean card.
    expect(container.textContent).not.toContain("⚠");
  });
});

describe("BoardCard field health via shared list cells (A137.1)", () => {
  // @verifies A137.1 — the card consumes the list cell's health prop.
  it("a whole-field-corrupt status shows the cell's (broken) marker, card stays", () => {
    // status value lifted into health (absent from frontmatter).
    const task: TaskFrontmatterPublic = { id: "01DDD", key: "WEB-10", title: "T" };
    const { container } = renderCard(task, {
      health: [health("status", { rawText: "99", error: "status is not a string" })],
      layout: ["status"],
    });

    // The card itself never vanishes.
    expect(container.querySelector('[data-testid="board-card-WEB-10"]')).toBeTruthy();
    // The shared list cell's OWN health marker is present — proof the
    // card passes health to the cell rather than reinventing a marker.
    expect(container.querySelector('[data-testid="field-health-status"]')).toBeTruthy();
    // The raw stored value is preserved (K27), not a blank/dash.
    expect(container.textContent).toContain("99");
  });

  it("a status field with no value and no health renders nothing (dense layout)", () => {
    const task: TaskFrontmatterPublic = { id: "01EEE", key: "WEB-11", title: "T" };
    const { container } = renderCard(task, { layout: ["status"] });
    // No status, no health → the board omits the field (not a dash).
    expect(container.querySelector('[data-testid="field-health-status"]')).toBeNull();
    expect(container.textContent).not.toContain("⚠");
  });
});

describe("BoardCard relationship markers (BRD-50 / UX-5)", () => {
  const clean: TaskFrontmatterPublic = { id: "01F", key: "WEB-20", title: "T" };

  // @verifies BRD-50
  it("shows a blocked marker when the task is blocked", () => {
    renderCard(clean, {
      badges: { blocked: true, blockerCount: 2, childCount: 0, isSubtask: false },
    });
    const marker = screen.getByTestId("board-card-blocked-WEB-20");
    expect(marker).toBeTruthy();
    expect(marker.textContent).toContain("Blocked");
    // The count is discoverable via the title.
    expect(marker.getAttribute("title")).toBe("Blocked by 2 tasks");
    // B3 (A327): not the danger/Critical red — blocked is a normal state.
    expect(marker.querySelector(".text-danger-fg")).toBeNull();
  });

  // @verifies BRD-50
  it("shows a child-count badge on an epic/parent card", () => {
    renderCard(clean, {
      badges: { blocked: false, blockerCount: 0, childCount: 3, isSubtask: false },
    });
    const badge = screen.getByTestId("board-card-epic-WEB-20");
    expect(badge.textContent).toContain("3");
    expect(badge.getAttribute("title")).toBe("Epic with 3 children");
  });

  // @verifies BRD-50
  it("shows a 'belongs to epic' hint on a subtask", () => {
    renderCard(clean, {
      badges: { blocked: false, blockerCount: 0, childCount: 0, isSubtask: true },
    });
    expect(screen.getByTestId("board-card-subtask-WEB-20")).toBeTruthy();
  });

  it("renders no markers on a clean card (no badges / all false)", () => {
    const { container } = renderCard(clean, {
      badges: { blocked: false, blockerCount: 0, childCount: 0, isSubtask: false },
    });
    expect(container.querySelector('[data-testid="board-card-blocked-WEB-20"]')).toBeNull();
    expect(container.querySelector('[data-testid="board-card-epic-WEB-20"]')).toBeNull();
    expect(container.querySelector('[data-testid="board-card-subtask-WEB-20"]')).toBeNull();
  });

  it("renders no markers when badges is absent (a clean card is unchanged)", () => {
    const { container } = renderCard(clean);
    expect(container.querySelector('[data-testid^="board-card-blocked"]')).toBeNull();
    expect(container.querySelector('[data-testid^="board-card-epic"]')).toBeNull();
  });
});

describe("BoardCard due date (K135)", () => {
  // K135: a past due date is shown plainly. The board used to colour it
  // `text-danger-fg` and bold it; Ken ruled "remove". Asserted by the
  // rendered class and text, not a testid, so a restyle that brings the
  // red back under another name still fails here.
  // @verifies BRD-5
  it("renders a past due date exactly like a future one: no danger colour, no weight, no 'overdue'", () => {
    const layout: readonly CardLayoutField[] = ["due_date"];
    // `today` in renderCard is 2026-09-06.
    renderCard({ id: "01DUEPAST", key: "WEB-20", title: "Past", due_date: "2026-06-20" }, { layout });
    renderCard({ id: "01DUEFUTR", key: "WEB-21", title: "Future", due_date: "2026-12-01" }, { layout });

    const past = within(screen.getByTestId("board-card-WEB-20")).getByText("Jun 20");
    const future = within(screen.getByTestId("board-card-WEB-21")).getByText("Dec 1");

    expect(past.className).not.toMatch(/danger|red|font-(medium|semibold|bold)/);
    expect(past.className).toBe(future.className);
    expect(screen.getByTestId("board-card-WEB-20").textContent).not.toMatch(/overdue/i);
  });
});
