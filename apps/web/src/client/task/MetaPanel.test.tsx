// @vitest-environment jsdom
import type { TaskFrontmatterPublic, WorkflowConfig } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WireHealth } from "../health/fieldHealth.ts";
import { buildLookups } from "../list/lookups.ts";
import { MetaPanel } from "./MetaPanel.tsx";

/**
 * MetaPanel degradation rendering (DEG-29 / DEG-7 / UX-7).
 *
 * The tolerant parse lifts a corrupt field's value out of `frontmatter`
 * into `health`, and preserves an unrecognised key as a `health` entry of
 * kind `unrecognised`. The panel renders from `frontmatter` alone would
 * therefore draw a corrupt `due_date` as a bare "—" (indistinguishable
 * from no value) and would never show the preserved `jira_id` at all —
 * the DEG-7 client blind spot (before this, only a *core* round-trip test
 * and one sr-only list-cell span existed).
 *
 * These tests render the real panel with a `health` payload shaped exactly
 * as `GET /api/tasks/:ref` delivers it and assert on the DOM the user sees.
 */

const WORKFLOW: WorkflowConfig = {
  statuses: [{ key: "todo", label: "To do", category: "todo" }],
  priorities: [],
  task_types: [],
  relationship_types: [],
  custom_fields: [],
} as unknown as WorkflowConfig;

const LOOKUPS = buildLookups({
  projects: [],
  users: [],
  labels: [],
  workflow: WORKFLOW,
});

function renderPanel(overrides: {
  frontmatter?: Partial<TaskFrontmatterPublic>;
  health?: readonly WireHealth[];
  onUnset?: (field: string) => void;
}) {
  const fm: TaskFrontmatterPublic = {
    id: "01TASK0000000000000000000",
    key: "T-1",
    title: "A task",
    status: "todo",
    ...overrides.frontmatter,
  };
  const onUnset = overrides.onUnset ?? vi.fn();
  render(
    <MetaPanel
      frontmatter={fm}
      {...(overrides.health !== undefined ? { health: overrides.health } : {})}
      lookups={LOOKUPS}
      workflow={WORKFLOW}
      users={[]}
      labels={[]}
      milestones={[]}
      sprints={[]}
      calendar={undefined}
      onSet={vi.fn()}
      onUnset={onUnset}
      onCreateLabel={vi.fn(() => Promise.resolve(undefined))}
      searchLabels={vi.fn(() => Promise.resolve([]))}
      searchMilestones={vi.fn(() => Promise.resolve([]))}
      searchSprints={vi.fn(() => Promise.resolve([]))}
      searchUsers={vi.fn(() => Promise.resolve([]))}
    />,
  );
  return { onUnset };
}

afterEach(cleanup);

describe("DEG-29 — a corrupt field renders with an inline warning, not a bare —", () => {
  const CORRUPT_DUE: WireHealth = {
    field: "due_date",
    kind: "wrong_type",
    rawText: "42",
    error: "due_date: Expected string, received number",
    repair: "set_or_remove",
  };

  // @verifies DEG-29
  it("shows the stored raw value with a warning marker, distinguishable from empty", () => {
    // The value is NOT on frontmatter — the tolerant parse lifted it into
    // health. A panel reading only `fm.due_date` renders an empty Due row.
    renderPanel({ frontmatter: { due_date: undefined }, health: [CORRUPT_DUE] });

    const notice = screen.getByTestId("meta-corrupt-due");
    // The raw stored value is visible — 42, not "—".
    expect(within(notice).getByTestId("meta-corrupt-raw-due").textContent).toBe("42");
    // The warning word marks it as corrupt, not as a legitimate value.
    expect(notice.textContent).toMatch(/corrupt/i);
    // The validator's message is available (tooltip) so the user can act.
    expect(notice.querySelector("[title]")?.getAttribute("title")).toContain(
      "Expected string",
    );
  });

  // @verifies DEG-29
  it("offers a Clear control that unsets the corrupt field", () => {
    const { onUnset } = renderPanel({
      frontmatter: { due_date: undefined },
      health: [CORRUPT_DUE],
    });

    fireEvent.click(screen.getByTestId("meta-corrupt-clear-due"));
    expect(onUnset).toHaveBeenCalledWith("due_date");
  });

  // @verifies DEG-29
  it("a healthy, unset field shows no corrupt notice (— is honest there)", () => {
    // No health at all — the Due row is genuinely empty, and must NOT gain
    // a spurious corrupt warning.
    renderPanel({ frontmatter: { due_date: undefined } });
    expect(screen.queryByTestId("meta-corrupt-due")).toBeNull();
  });
});

describe("DEG-29 — a corrupt CUSTOM field clears by its bare key, not the dotted health key", () => {
  // The health entry for a custom field is keyed `fields.<key>` (that is how
  // the workflow validator attributes it), but core's unset — like the
  // healthy custom-field editor — takes the BARE key. Sending the dotted
  // form 400s ("custom field \"fields.points\" is not set"), so the Clear on
  // a corrupt custom field would never work.
  const CUSTOM_WORKFLOW = {
    statuses: [{ key: "todo", label: "To do", category: "todo" }],
    priorities: [],
    task_types: [],
    relationship_types: [],
    custom_fields: [{ key: "points", label: "Points", type: "number" }],
  } as unknown as WorkflowConfig;
  const CUSTOM_LOOKUPS = buildLookups({ projects: [], users: [], labels: [], workflow: CUSTOM_WORKFLOW });
  // A value-lifted (wrong_type) fault: the raw value is in health, not on
  // frontmatter, so the row would show a bare "—" without the notice. This
  // is the kind that surfaces the corrupt notice + Clear for a custom field.
  const CORRUPT_POINTS: WireHealth = {
    field: "fields.points",
    kind: "wrong_type",
    rawText: "abc",
    error: 'points: Expected number, received string ("abc")',
    repair: "set_or_remove",
  };

  // @verifies DEG-29
  it("Clear on a corrupt custom field unsets the BARE key", () => {
    const onUnset = vi.fn();
    render(
      <MetaPanel
        frontmatter={{ id: "01TASK0000000000000000000", key: "T-1", title: "A task", status: "todo" } as TaskFrontmatterPublic}
        health={[CORRUPT_POINTS]}
        lookups={CUSTOM_LOOKUPS}
        workflow={CUSTOM_WORKFLOW}
        users={[]}
        labels={[]}
        milestones={[]}
        sprints={[]}
        calendar={undefined}
        onSet={vi.fn()}
        onUnset={onUnset}
        onCreateLabel={vi.fn(() => Promise.resolve(undefined))}
        searchLabels={vi.fn(() => Promise.resolve([]))}
        searchMilestones={vi.fn(() => Promise.resolve([]))}
        searchSprints={vi.fn(() => Promise.resolve([]))}
        searchUsers={vi.fn(() => Promise.resolve([]))}
      />,
    );

    fireEvent.click(screen.getByTestId("meta-corrupt-clear-points"));
    // The bare key — what core's unset (and the healthy editor) expect.
    // The dotted `fields.points` would 400.
    expect(onUnset).toHaveBeenCalledWith("points");
    expect(onUnset).not.toHaveBeenCalledWith("fields.points");
  });
});

describe("DEG-7 / DEG-29 — unrecognised preserved fields render in a client group", () => {
  const JIRA: WireHealth = {
    field: "jira_id",
    kind: "unrecognised",
    rawText: "ABC-123",
    error: "unrecognised key",
    repair: "remove",
  };

  // @verifies DEG-7
  // @verifies DEG-29
  it("renders a 'Not recognised' group listing the preserved key and value", () => {
    // This is the DEG-7 CLIENT render: before it, DEG-7 was 'covered' only
    // by a core round-trip test (frontmatter.test.ts) — no client showed
    // the key. The group is what closes that blind spot.
    renderPanel({ health: [JIRA] });

    const group = screen.getByTestId("meta-unrecognised-group");
    expect(group.textContent).toContain("Not recognised");
    const row = within(group).getByTestId("meta-unrecognised-jira-id");
    expect(row.textContent).toContain("jira_id");
    expect(row.textContent).toContain("ABC-123");
  });

  // @verifies DEG-7
  it("offers a Remove control that unsets the preserved key", () => {
    const { onUnset } = renderPanel({ health: [JIRA] });
    fireEvent.click(screen.getByTestId("meta-unrecognised-remove-jira-id"));
    expect(onUnset).toHaveBeenCalledWith("jira_id");
  });

  // @verifies DEG-7
  it("omits the group entirely when nothing is unrecognised", () => {
    renderPanel({ health: [] });
    expect(screen.queryByTestId("meta-unrecognised-group")).toBeNull();
  });
});
