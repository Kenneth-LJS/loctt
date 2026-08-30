import type { CardLayoutField, TaskFrontmatterPublic } from "@loctt/contracts";

import {
  AssigneeCell,
  LabelsCell,
  PriorityCell,
  ProjectChip,
  StatusBadge,
  TypeBadge,
} from "../list/cells.tsx";
import { isOverdue, shortDate } from "../list/format.ts";
import type { buildLookups } from "../list/lookups.ts";

/**
 * One card on the board.
 *
 * Every field renderer is imported from the list's `cells.tsx` rather
 * than reimplemented. MSL-5 is explicit that a label must render with
 * the same colour on the list row, the board card and the task detail
 * — "one colour source, no per-surface palette" — and the only way to
 * hold that is to share the component, not to copy its rules. The same
 * argument covers the status, priority and type badges: a second
 * palette here would drift the first time either was edited.
 *
 * Not draggable. Drag-and-drop is M3.2; this renders and navigates.
 */
export function BoardCard({
  task,
  layout,
  lookups,
  milestones,
  sprints,
  today,
  onOpen,
  onFilterLabel,
}: {
  readonly task: TaskFrontmatterPublic;
  readonly layout: readonly CardLayoutField[];
  readonly lookups: ReturnType<typeof buildLookups>;
  readonly milestones: readonly { id: string; name: string }[];
  readonly sprints: readonly { id: string; name: string }[];
  /**
   * The *workspace's* date, from `/api/info` — not the browser's. A
   * due date is compared against the tracker's calendar, so a user in
   * another timezone must not see a different set of overdue cards
   * than the CLI reports.
   */
  readonly today: string;
  readonly onOpen: (key: string) => void;
  readonly onFilterLabel: (id: string) => void;
}) {
  const milestoneName = milestones.find(m => m.id === task.milestone)?.name;
  const sprintName = sprints.find(s => s.id === task.sprint)?.name;

  return (
    <article
      data-testid={`board-card-${task.key}`}
      data-task-key={task.key}
      // BRD-8: clicking anywhere on the card body opens the task. A
      // button rather than a div so it is keyboard-reachable and shows
      // a focus ring without hand-rolling either (BRD-38 builds the
      // *move* gesture on top of this in M3.2; reachability is here).
      className="rounded border border-border-subtle bg-bg-base focus-within:ring-2 focus-within:ring-accent-fg"
    >
      <button
        type="button"
        onClick={() => { onOpen(task.key); }}
        className="block w-full cursor-pointer p-2 text-left"
      >
        {/* BRD-22: a 300-character title clamps to a fixed number of
            lines rather than growing the card to fill the column. */}
        <span className="line-clamp-3 text-[13px] text-text-primary">
          {task.title}
        </span>
      </button>

      <div className="space-y-1.5 px-2 pb-2">
        {layout.map(field => {
          const rendered = renderField({
            field,
            task,
            lookups,
            milestoneName,
            sprintName,
            today,
            onFilterLabel,
          });
          if (rendered === null) return null;
          return (
            <div key={field} data-testid={`board-card-field-${field}`} className="text-[12px]">
              {rendered}
            </div>
          );
        })}
      </div>
    </article>
  );
}

/**
 * Renders one `card_layout` field, or `null` when the task has no
 * value for it.
 *
 * Absent fields render nothing rather than a dash: a card is a dense
 * surface and a column of em-dashes is noise, where a table row needs
 * the cell to hold its column. That is the one place the board departs
 * from the list's cells, and it is a layout decision, not a data one.
 */
function renderField({
  field,
  task,
  lookups,
  milestoneName,
  sprintName,
  today,
  onFilterLabel,
}: {
  field: CardLayoutField;
  task: TaskFrontmatterPublic;
  lookups: ReturnType<typeof buildLookups>;
  milestoneName: string | undefined;
  sprintName: string | undefined;
  today: string;
  onFilterLabel: (id: string) => void;
}): React.ReactNode {
  switch (field) {
    case "key":
      return (
        <span className="flex items-center gap-1.5">
          {/* BRD-23: on an "All projects" board the key prefixes come
              from different projects, so the card carries a project
              indicator to keep WEB-3 and BACKEND-3 apart. */}
          {task.project !== undefined && (
            <ProjectChip def={lookups.project(task.project)} raw={task.project} />
          )}
          <span className="font-mono text-[11px] text-text-tertiary">{task.key}</span>
        </span>
      );
    case "status":
      return task.status === undefined
        ? null
        : <StatusBadge def={lookups.status(task.status)} raw={task.status} />;
    case "priority":
      return task.priority === undefined
        ? null
        : <PriorityCell def={lookups.priority(task.priority)} raw={task.priority} />;
    case "task_type":
      return task.task_type === undefined
        ? null
        : <TypeBadge def={lookups.taskType(task.task_type)} raw={task.task_type} />;
    case "assignee":
      return task.assignee === undefined
        ? null
        : <AssigneeCell user={lookups.user(task.assignee)} raw={task.assignee} />;
    case "labels": {
      const ids = task.labels ?? [];
      if (ids.length === 0) return null;
      // MSL-20: twenty labels overflow to a `+N` rather than widening
      // the card past its column. The shared cell already caps the
      // pills and each remaining pill stays individually clickable to
      // filter (MSL-6).
      return (
        <LabelsCell
          labels={ids.map(id => lookups.label(id) ?? { id })}
          onFilter={onFilterLabel}
        />
      );
    }
    case "due_date": {
      const due = task.due_date;
      if (due === undefined) return null;
      return (
        <span className={isOverdue(due, today) ? "font-medium text-danger-fg" : "text-text-secondary"}>
          {shortDate(due, today)}
        </span>
      );
    }
    case "estimate":
      return task.estimate === undefined
        ? null
        : <span className="text-text-secondary">{task.estimate}</span>;
    case "milestone":
      return task.milestone === undefined
        ? null
        : (
            <span className="text-text-secondary">
              {milestoneName ?? "unknown milestone"}
            </span>
          );
    case "sprint":
      return task.sprint === undefined
        ? null
        : (
            <span className="text-text-secondary">
              {sprintName ?? "unknown sprint"}
            </span>
          );
  }
}
