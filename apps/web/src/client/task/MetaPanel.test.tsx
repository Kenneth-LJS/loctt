// @vitest-environment jsdom
import type { LabelDef, TaskFrontmatterPublic, UserProfile, WorkflowConfig } from "@loctt/contracts";
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
  onSet?: (field: string, value: unknown) => void;
  users?: readonly UserProfile[];
  currentUser?: UserProfile | null;
  identityUnknown?: boolean;
  labels?: readonly LabelDef[];
  workflow?: WorkflowConfig;
}) {
  const fm: TaskFrontmatterPublic = {
    id: "01TASK0000000000000000000",
    key: "T-1",
    title: "A task",
    status: "todo",
    ...overrides.frontmatter,
  };
  const onUnset = overrides.onUnset ?? vi.fn();
  const onSet = overrides.onSet ?? vi.fn();
  render(
    <MetaPanel
      frontmatter={fm}
      {...(overrides.health !== undefined ? { health: overrides.health } : {})}
      lookups={LOOKUPS}
      workflow={overrides.workflow ?? WORKFLOW}
      users={overrides.users ?? []}
      labels={overrides.labels ?? []}
      milestones={[]}
      sprints={[]}
      calendar={undefined}
      {...(overrides.currentUser !== undefined ? { currentUser: overrides.currentUser } : {})}
      {...(overrides.identityUnknown !== undefined ? { identityUnknown: overrides.identityUnknown } : {})}
      onSet={onSet}
      onUnset={onUnset}
      onCreateLabel={vi.fn(() => Promise.resolve(undefined))}
      searchLabels={vi.fn(() => Promise.resolve([]))}
      searchMilestones={vi.fn(() => Promise.resolve([]))}
      searchSprints={vi.fn(() => Promise.resolve([]))}
      searchUsers={vi.fn(() => Promise.resolve([]))}
    />,
  );
  return { onUnset, onSet };
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

describe("TSK-12 / K91 — custom fields scope to a task's type", () => {
  // `sev` is scoped to type `defect`; `cmp` is global (no allowlist).
  const SCOPE_WORKFLOW = {
    statuses: [{ key: "todo", label: "To do", category: "todo" }],
    priorities: [],
    task_types: [
      { key: "defect", label: "Defect" },
      { key: "chore", label: "Chore" },
    ],
    relationship_types: [],
    custom_fields: [
      { key: "sev", label: "Severity", type: "string", multi: false, searchable: false, task_types: ["defect"] },
      { key: "cmp", label: "Component", type: "string", multi: false, searchable: false },
    ],
  } as unknown as WorkflowConfig;
  const SCOPE_LOOKUPS = buildLookups({ projects: [], users: [], labels: [], workflow: SCOPE_WORKFLOW });

  function renderScoped(fm: Partial<TaskFrontmatterPublic>, onUnset = vi.fn()) {
    const rendered = render(
      <MetaPanel
        frontmatter={{ id: "01TASK0000000000000000000", key: "T-1", title: "A task", status: "todo", ...fm } as TaskFrontmatterPublic}
        lookups={SCOPE_LOOKUPS}
        workflow={SCOPE_WORKFLOW}
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
    return { onUnset, rerender: rendered.rerender };
  }

  // The editable string control is collapsed behind `meta-edit-<slug>`
  // (slug is the lower-cased label) until clicked; asserting on the
  // trigger's presence is asserting the row exists.
  // @verifies TSK-12
  it("a scoped field shows for its type and hides for another; a global field shows for both", () => {
    // Type `defect`: both the scoped `sev` (label Severity) and the
    // global `cmp` (label Component) appear.
    renderScoped({ task_type: "defect" });
    expect(screen.getByTestId("meta-edit-severity")).toBeTruthy();
    expect(screen.getByTestId("meta-edit-component")).toBeTruthy();
    cleanup();

    // Type `chore`: the scoped Severity is gone (no stored value),
    // Component stays.
    renderScoped({ task_type: "chore" });
    expect(screen.queryByTestId("meta-edit-severity")).toBeNull();
    expect(screen.getByTestId("meta-edit-component")).toBeTruthy();
  });

  // @verifies TSK-12
  it("changing the type flips the visible set with no reload — the panel re-renders from fm", () => {
    const { rerender } = renderScoped({ task_type: "defect" });
    expect(screen.getByTestId("meta-edit-severity")).toBeTruthy();

    // Same component instance, new frontmatter (as the optimistic type
    // change delivers). No refetch, no remount.
    rerender(
      <MetaPanel
        frontmatter={{ id: "01TASK0000000000000000000", key: "T-1", title: "A task", status: "todo", task_type: "chore" } as TaskFrontmatterPublic}
        lookups={SCOPE_LOOKUPS}
        workflow={SCOPE_WORKFLOW}
        users={[]}
        labels={[]}
        milestones={[]}
        sprints={[]}
        calendar={undefined}
        onSet={vi.fn()}
        onUnset={vi.fn()}
        onCreateLabel={vi.fn(() => Promise.resolve(undefined))}
        searchLabels={vi.fn(() => Promise.resolve([]))}
        searchMilestones={vi.fn(() => Promise.resolve([]))}
        searchSprints={vi.fn(() => Promise.resolve([]))}
        searchUsers={vi.fn(() => Promise.resolve([]))}
      />,
    );
    expect(screen.queryByTestId("meta-edit-severity")).toBeNull();
  });

  // @verifies TSK-12
  it("an out-of-scope field WITH a stored value renders read-only, with a note and a Remove action (K91)", () => {
    // The task is now a `chore` but carries a `sev` value set while it
    // was a `defect`. K91: keep it, show it read-only, never hide it.
    const onUnset = vi.fn();
    renderScoped({ task_type: "chore", fields: { sev: "high" } }, onUnset);

    // Not the editable control — it is out of scope.
    expect(screen.queryByTestId("meta-edit-severity")).toBeNull();

    const readonly = screen.getByTestId("meta-out-of-scope-sev");
    expect(readonly.textContent).toContain("high");

    // The note names why, and there is a Remove action.
    const remove = screen.getByRole("button", { name: /Remove Severity/i });
    fireEvent.click(remove);
    expect(onUnset).toHaveBeenCalledWith("sev");
  });

  // @verifies TSK-12
  it("an out-of-scope field with NO stored value does not appear at all", () => {
    renderScoped({ task_type: "chore" });
    expect(screen.queryByTestId("meta-out-of-scope-sev")).toBeNull();
    expect(screen.queryByTestId("meta-edit-severity")).toBeNull();
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

describe("L2 — an unset editable row invites action, not a bare —", () => {
  // Ken's own report ("fields that are meant to be dropdowns don't look like
  // dropdowns"), at the copy layer: an empty editable row shows an
  // action-phrased placeholder ("Add assignee", "Set due date") rather than
  // the "—" glyph reserved for read-only absence.

  // @verifies L2
  it("shows action-phrased placeholders on unset editable rows", () => {
    renderPanel({
      frontmatter: {
        assignee: undefined,
        reporter: undefined,
        milestone: undefined,
        sprint: undefined,
        start_date: undefined,
        due_date: undefined,
        task_type: undefined,
        priority: undefined,
      },
    });
    expect(screen.getByTestId("meta-edit-assignee").textContent).toContain("Add assignee");
    expect(screen.getByTestId("meta-edit-reporter").textContent).toContain("Add reporter");
    expect(screen.getByTestId("meta-edit-milestone").textContent).toContain("Add milestone");
    expect(screen.getByTestId("meta-edit-sprint").textContent).toContain("Add to sprint");
    expect(screen.getByTestId("meta-edit-start").textContent).toContain("Set start date");
    expect(screen.getByTestId("meta-edit-due").textContent).toContain("Set due date");
    expect(screen.getByTestId("meta-edit-type").textContent).toContain("Set type");
    expect(screen.getByTestId("meta-edit-priority").textContent).toContain("Set priority");
  });

  // @verifies L2
  it("keeps the accessible 'not set' name so screen readers are unaffected", () => {
    // The visible words change; the accessible name must still say "not set"
    // (A11Y — empty editable fields keep a "not set" accessible name).
    renderPanel({ frontmatter: { assignee: undefined, due_date: undefined } });
    expect(screen.getByTestId("meta-edit-assignee").getAttribute("aria-label"))
      .toContain("not set");
    expect(screen.getByTestId("meta-edit-due").getAttribute("aria-label"))
      .toContain("not set");
  });

  // @verifies L2
  it("keeps '—' for a genuinely read-only row (Project when unset)", () => {
    // Project is not editable (a move rekeys); its empty state stays "—",
    // not an action phrase.
    renderPanel({ frontmatter: { project: undefined } });
    // No edit trigger for Project — it renders plain text.
    expect(screen.queryByTestId("meta-edit-project")).toBeNull();
    // The panel still contains the read-only dash rather than an "Add
    // project" phrase.
    expect(screen.getByTestId("meta-panel").textContent).not.toContain("Add project");
  });
});

describe("L3 — 'Assign to me' quick action", () => {
  const ME: UserProfile = {
    id: "01USERME000000000000000AA",
    name: "Ada Byron",
  } as unknown as UserProfile;

  // @verifies L3
  it("writes the current user's id when the task is not assigned to me", () => {
    const { onSet } = renderPanel({
      frontmatter: { assignee: undefined },
      users: [ME],
      currentUser: ME,
    });
    fireEvent.click(screen.getByTestId("meta-assign-to-me"));
    expect(onSet).toHaveBeenCalledWith("assignee", ME.id);
  });

  // @verifies L3
  it("is hidden when I am already the assignee", () => {
    renderPanel({
      frontmatter: { assignee: ME.id },
      users: [ME],
      currentUser: ME,
    });
    expect(screen.queryByTestId("meta-assign-to-me")).toBeNull();
  });

  // @verifies L3
  it("is hidden when identity is unknown (SHL-40)", () => {
    renderPanel({
      frontmatter: { assignee: undefined },
      users: [],
      currentUser: null,
      identityUnknown: true,
    });
    expect(screen.queryByTestId("meta-assign-to-me")).toBeNull();
  });

  // @verifies L3
  it("is hidden when the current user is archived", () => {
    const archivedMe = { ...ME, archived: true } as unknown as UserProfile;
    renderPanel({
      frontmatter: { assignee: undefined },
      users: [archivedMe],
      currentUser: archivedMe,
    });
    expect(screen.queryByTestId("meta-assign-to-me")).toBeNull();
  });

  // @verifies L3
  it("renders the assignee's avatar beside the picker", () => {
    renderPanel({
      frontmatter: { assignee: ME.id },
      users: [ME],
      currentUser: ME,
    });
    expect(screen.getByTestId("meta-assignee-avatar")).not.toBeNull();
  });
});

/**
 * #15 (WCAG 2.5.8 AA): the chip ✕-remove controls in the meta panel carry
 * a ≥24px hit target, and the single-line meta editors share one control
 * height (`min-h-7`) rather than varying 17–50px in a viewport.
 *
 * The ✕ glyph stays 12px; the button's `min-h-6 min-w-6` (24px) is the
 * clickable target. Red-proof: before the fix the buttons rendered a bare
 * `Icon size={12}` with no min hit area, so this assertion fails.
 */
describe("#15 — tap targets and control-height normalization", () => {
  const LABELS: readonly LabelDef[] = [
    { id: "l_fe", name: "frontend", color: "#1e6fcb" } as unknown as LabelDef,
  ];

  const WF_WITH_MULTI: WorkflowConfig = {
    statuses: [{ key: "todo", label: "To do", category: "todo" }],
    priorities: [],
    task_types: [],
    relationship_types: [],
    custom_fields: [
      {
        key: "areas",
        label: "Areas",
        type: "enum",
        multi: true,
        searchable: false,
        values: [
          { key: "ui", label: "UI" },
          { key: "api", label: "API" },
        ],
      },
    ],
  } as unknown as WorkflowConfig;

  it("gives the label ✕-remove a ≥24px hit target (glyph stays 12px)", () => {
    renderPanel({ frontmatter: { labels: ["l_fe"] }, labels: LABELS });
    const remove = screen.getByRole("button", { name: "Remove label frontend" });
    expect(remove.className).toContain("min-h-6");
    expect(remove.className).toContain("min-w-6");
    // The glyph itself is untouched — still the small 12px icon.
    const svg = remove.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("12");
  });

  it("gives the multi-select custom-field ✕-remove a ≥24px hit target", () => {
    renderPanel({
      frontmatter: { fields: { areas: ["ui"] } },
      workflow: WF_WITH_MULTI,
    });
    const remove = screen.getByRole("button", { name: "Remove UI from Areas" });
    expect(remove.className).toContain("min-h-6");
    expect(remove.className).toContain("min-w-6");
  });

  it("normalizes single-line meta editors to the standard control height (min-h-7)", () => {
    // The Status / Type / Priority editors are OptionPicker triggers; the
    // Estimate editor (numeric) is a TextField display. Both must share the
    // one control height so the panel does not show 17–50px variance.
    // Red-proof: before the fix the triggers used `py-0.5` with no height
    // floor, so no `min-h-7` was present.
    renderPanel({ frontmatter: { status: "todo" } });
    const statusTrigger = screen.getByRole("button", { name: /Status/ });
    expect(statusTrigger.className).toContain("min-h-7");
  });
});

describe("UI-7 — meta rows do not double in height for a two-word value", () => {
  // jsdom does not run layout, so these cannot assert the measured
  // 42.67px -> 24.5px row-height fix directly — that was verified live,
  // at 1440x900 and 375x812 against the built client (see
  // docs/dev/design/ui-issues.md UI-7). What jsdom CAN assert is the
  // class-level cause and Ken's two decisions: the value column widens
  // on desktop and the row stacks on mobile, both via plain Tailwind
  // responsive classes (no `useIsNarrow`, since the DOM does not
  // differ), and the `Dropdown` trigger's shrink-to-fit wrapper is
  // forced to stretch to that column's full width.

  it("lays the row out as one column (mobile: label above value) below `sm`, two columns at `sm` and up", () => {
    renderPanel({ frontmatter: { status: "todo" } });
    const row = screen.getByRole("button", { name: /Status/ }).closest(".grid");
    expect(row).not.toBeNull();
    expect(row?.className).toMatch(/\bgrid-cols-1\b/);
    expect(row?.className).toMatch(/\bsm:grid-cols-\[/);
  });

  it("stretches the OptionPicker trigger's wrapper to fill the value column instead of shrink-to-fit", () => {
    // `ui/Dropdown`'s trigger root is `relative inline-flex`, which sizes
    // to its content and does not stretch even when its container is
    // wide enough — confirmed live: widening the grid column alone (163px
    // already had headroom) did not fix the wrap, forcing this wrapper to
    // `flex w-full` did. `ui/Dropdown.tsx` is a shared primitive out of
    // this change's scope, so the stretch is a child-selector applied
    // from the row/wrapper that owns the column.
    renderPanel({ frontmatter: { status: "todo" } });
    const trigger = screen.getByTestId("meta-edit-status");
    const dd = trigger.closest("dd");
    expect(dd).not.toBeNull();
    expect(dd?.className ?? "").toMatch(/\[&>\.relative\.inline-flex\]:flex/);
    expect(dd?.className ?? "").toMatch(/\[&>\.relative\.inline-flex\]:w-full/);
  });

  it("applies the same stretch fix to Assignee/Reporter, where the picker is not dd's direct child", () => {
    // Assignee/Reporter nest the picker inside an avatar row, so the
    // `dd`-level selector above does not reach it — the fix has to be
    // repeated one level down, on the `min-w-0 flex-1` div that IS the
    // picker's immediate parent there.
    renderPanel({ frontmatter: {} });
    const trigger = screen.getByTestId("meta-edit-assignee");
    const wrap = trigger.parentElement?.parentElement; // relative.inline-flex -> min-w-0 flex-1
    expect(wrap?.className ?? "").toMatch(/\[&>\.relative\.inline-flex\]:flex/);
    expect(wrap?.className ?? "").toMatch(/\[&>\.relative\.inline-flex\]:w-full/);
  });
});
