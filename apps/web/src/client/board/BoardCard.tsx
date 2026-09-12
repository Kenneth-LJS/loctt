import type { CardLayoutField, TaskFrontmatterPublic } from "@loctt/contracts";

import type { WireHealth } from "../health/fieldHealth.ts";
import { fieldView } from "../health/fieldHealth.ts";
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
import { Chip } from "../ui/Chip.tsx";
import type { BoardCardBadges } from "./relationshipBadges.ts";

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
 * Draggable as of M3.2: the gesture is armed by `onPointerDown`
 * (see `useBoardDrag`) and mirrored on the keyboard by `onMoveKey`.
 * A press that never passes the threshold stays a click and opens the
 * task (BRD-8, BRD-37).
 */
export function BoardCard({
  task,
  badges,
  health,
  layout,
  lookups,
  milestones,
  sprints,
  today,
  onOpen,
  onFilterLabel,
  onPointerDown,
  onMoveKey,
  placeholder = false,
}: {
  readonly task: TaskFrontmatterPublic;
  /**
   * BRD-50 (UX-5): the relationship-derived signals for this card —
   * blocked, epic child-count, subtask. Computed once in `BoardView`
   * from the workflow config (see `boardCardBadges`) and threaded in so
   * the card stays presentational and does not re-read config per card.
   * Absent renders no markers (a clean card is unchanged).
   */
  readonly badges?: BoardCardBadges | undefined;
  /**
   * The task's field-level health findings (A137 / A137.1), threaded
   * from the list feed the board reads (`TaskListRow.health`). Absent
   * when the task is clean — a clean card renders exactly as before.
   * Passed to the shared list cells so their existing ⚠/"(broken)"
   * markers light up on the card, and read here for the title's own
   * fallback + marker.
   */
  readonly health?: readonly WireHealth[] | undefined;
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
  /**
   * Arms a drag (M3.2). Absent on the floating preview, which must
   * not itself be draggable.
   */
  readonly onPointerDown?: (e: React.PointerEvent) => void;
  /**
   * BRD-38: the keyboard equivalent of a drag. Ctrl/Cmd + arrow.
   */
  readonly onMoveKey?: (direction: "left" | "right" | "up" | "down") => void;
  /**
   * This card is the one being dragged (BRD-11). It keeps its box —
   * so the column does not collapse and the drop geometry still
   * matches the screen — but renders as an empty slot.
   */
  readonly placeholder?: boolean;
}) {
  const milestoneName = milestones.find(m => m.id === task.milestone)?.name;
  const sprintName = sprints.find(s => s.id === task.sprint)?.name;

  // K26: `title` is field-local. A corrupt/absent title still loads the
  // task (its identity is `id`/`key`), so the card title must never go
  // blank — a blank title hides the card, the exact failure this sweep
  // removes. Fall back to the key, and when the title was corrupt
  // (lifted whole into `health`) mark it with the same ⚠ the list uses.
  const titleHealth = fieldView<string>("title", task.title, health).fieldHealth;
  const shownTitle = task.title ?? task.key;

  return (
    <article
      data-testid={`board-card-${task.key}`}
      data-task-key={task.key}
      // BRD-8: clicking anywhere on the card body opens the task. A
      // button rather than a div so it is keyboard-reachable and shows
      // a focus ring without hand-rolling either (BRD-38 builds the
      // *move* gesture on top of this in M3.2; reachability is here).
      data-placeholder={placeholder ? "true" : undefined}
      className={[
        "rounded border focus-within:ring-2 focus-within:ring-accent",
        placeholder
          ? "border-dashed border-border-subtle bg-bg-muted/40 opacity-40 [&_*]:invisible"
          : "border-border-subtle bg-bg-canvas",
      ].join(" ")}
      onPointerDown={onPointerDown}
    >
      <button
        type="button"
        onClick={() => { onOpen(task.key); }}
        // BRD-38: Ctrl/Cmd + arrow moves the card. Plain arrows are
        // deliberately untouched so they still move focus and scroll
        // the column; a bare arrow key stealing the card would make
        // the board unnavigable by keyboard.
        onKeyDown={e => {
          if (onMoveKey === undefined) return;
          if (!e.ctrlKey && !e.metaKey) return;
          const dir =
            e.key === "ArrowLeft" ? "left"
            : e.key === "ArrowRight" ? "right"
            : e.key === "ArrowUp" ? "up"
            : e.key === "ArrowDown" ? "down"
            : null;
          if (dir === null) return;
          e.preventDefault();
          e.stopPropagation();
          onMoveKey(dir);
        }}
        className="block w-full cursor-grab p-2 text-left active:cursor-grabbing"
      >
        {/* BRD-22: a 300-character title clamps to a fixed number of
            lines rather than growing the card to fill the column. */}
        <span
          title={titleHealth?.error ?? task.title ?? task.key}
          className={[
            "flex items-start gap-1 text-[0.9286rem]",
            task.title === undefined ? "italic text-text-tertiary" : "text-text-primary",
          ].join(" ")}
        >
          <span className="line-clamp-3">{shownTitle}</span>
          {titleHealth !== undefined && (
            <span aria-hidden="true" title={titleHealth.error} className="shrink-0 text-danger-fg">⚠</span>
          )}
        </span>

        {/* BRD-50 (UX-5): the relationship-derived markers. A blocked
            card, an epic (with its child count), and a subtask ("belongs
            to epic") each get a discoverable pill so the signal is
            visible on the card, not only in detail. Rendered inside the
            open button — a click still opens the task — and only when the
            badge applies, so a clean card is unchanged. */}
        {badges !== undefined && (badges.blocked || badges.childCount > 0 || badges.isSubtask) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {badges.blocked && (
              <span
                data-testid={`board-card-blocked-${task.key}`}
                title={
                  badges.blockerCount === 1
                    ? "Blocked by 1 task"
                    : `Blocked by ${String(badges.blockerCount)} tasks`
                }
              >
                <Chip variant="neutral">
                  <span className="text-danger-fg">⛔ Blocked</span>
                </Chip>
              </span>
            )}
            {badges.childCount > 0 && (
              <span
                data-testid={`board-card-epic-${task.key}`}
                title={
                  badges.childCount === 1
                    ? "Epic with 1 child"
                    : `Epic with ${String(badges.childCount)} children`
                }
              >
                <Chip variant="accent">◇ {badges.childCount}</Chip>
              </span>
            )}
            {badges.isSubtask && (
              <span data-testid={`board-card-subtask-${task.key}`} title="Belongs to an epic">
                <Chip variant="neutral">↳ Subtask</Chip>
              </span>
            )}
          </span>
        )}
      </button>

      <div className="space-y-1.5 px-2 pb-2">
        {layout.map(field => {
          const rendered = renderField({
            field,
            task,
            health,
            lookups,
            milestoneName,
            sprintName,
            today,
            onFilterLabel,
          });
          if (rendered === null) return null;
          return (
            <div key={field} data-testid={`board-card-field-${field}`} className="text-[0.8571rem]">
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
  health,
  lookups,
  milestoneName,
  sprintName,
  today,
  onFilterLabel,
}: {
  field: CardLayoutField;
  task: TaskFrontmatterPublic;
  health: readonly WireHealth[] | undefined;
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
          <span className="font-mono text-[0.7857rem] text-text-tertiary">{task.key}</span>
        </span>
      );
    // A field's value can be absent because the task simply has none
    // (render nothing — the board's dense layout, unlike the table, does
    // not hold an empty slot) OR because a whole-field fault lifted its
    // value into `health` (A137.1 intrinsic). The latter must still show
    // the shared cell's ⚠/"(broken)" marker rather than vanish, so a
    // present `fieldHealth` overrides the "absent → null" shortcut.
    case "status": {
      const fh = fieldView("status", task.status, health).fieldHealth;
      return task.status === undefined && fh === undefined
        ? null
        : <StatusBadge def={lookups.status(task.status)} raw={task.status} health={fh} />;
    }
    case "priority": {
      const fh = fieldView("priority", task.priority, health).fieldHealth;
      return task.priority === undefined && fh === undefined
        ? null
        : <PriorityCell def={lookups.priority(task.priority)} raw={task.priority} health={fh} />;
    }
    case "task_type": {
      const fh = fieldView("task_type", task.task_type, health).fieldHealth;
      return task.task_type === undefined && fh === undefined
        ? null
        : <TypeBadge def={lookups.taskType(task.task_type)} raw={task.task_type} health={fh} />;
    }
    case "assignee": {
      const fh = fieldView("assignee", task.assignee, health).fieldHealth;
      return task.assignee === undefined && fh === undefined
        ? null
        : <AssigneeCell user={lookups.user(task.assignee)} raw={task.assignee} health={fh} />;
    }
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
