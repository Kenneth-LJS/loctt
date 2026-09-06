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
  } = {},
) {
  return render(
    <BoardCard
      task={task}
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
