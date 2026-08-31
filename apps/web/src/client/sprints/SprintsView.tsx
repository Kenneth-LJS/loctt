import type { CardLayoutField, SprintDef, TaskFrontmatterPublic } from "@loctt/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "../api/hooks/sidebarData.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { useSetField } from "../api/hooks/useSetField.ts";
import { useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { BoardCard } from "../board/BoardCard.tsx";
import { resolveCardLayout } from "../board/cardLayout.ts";
import { ConfigErrorState } from "../board/ConfigErrorState.tsx";
import type { DropNeighbours } from "../board/dragModel.ts";
import { neighboursAt } from "../board/dragModel.ts";
import type { DragState, DropRequest } from "../board/useBoardDrag.ts";
import { useBoardDrag } from "../board/useBoardDrag.ts";
import { buildLookups } from "../list/lookups.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import type { CollapseOverrides } from "./collapse.ts";
import { isExpanded, readOverrides, toggle, writeOverrides } from "./collapse.ts";
import type { SprintColumn } from "./columns.ts";
import {
  bucketBySprint,
  deriveSprintColumns,
  isActive,
  windowDisagrees,
} from "./columns.ts";
import { VirtualCards } from "./VirtualCards.tsx";

/**
 * The sprints overview (M3.5) — `/sprints`.
 *
 * One column per sprint, cards dragged between them to reassign the
 * task's `sprint`. `/sprints/$key` (the detail and burndown) is M4.7
 * and is deliberately not touched here.
 *
 * ## Why this is not the board with a different grouping
 *
 * It shares everything that can be shared — `BoardCard`, the drag
 * gesture, the card layout — and differs in the two places it must:
 *
 *  - **The write.** A board drop writes `status` + `board_rank` in one
 *    change set through `boardMove`. A sprint drop writes one field,
 *    `sprint`, and has no ordering of its own: `board_rank` is ranked
 *    within a *board column*, and a sprint column is not one. Writing
 *    a rank here would reorder the board as a side effect of a sprint
 *    reassignment. So this goes through `useSetField`, the same verb
 *    the meta panel uses, which also gives SPR-5 its rollback.
 *  - **The columns.** Derived from `sprints.yaml` plus the tasks,
 *    not from `workflow.yaml`. See `columns.ts`.
 */
export function SprintsView() {
  const navigate = useNavigate();

  const sprints = useSprints();
  const workflow = useWorkflow();
  const info = useInfo();
  const userSettings = useUserSettings();

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();

  // Whole columns, not a page of one — the same reason the board pages
  // to exhaustion. SPR-17 requires the header count to read the true
  // total (400), which a first page of 50 would make a lie.
  const params = useMemo(() => ({ limit: SPRINTS_PAGE_SIZE }), []);
  const tasks = useTasksFeed(params);

  // SPR-17: the view renders whole columns, so it exhausts the feed
  // rather than stopping at a page. A header reading "200" over 400
  // tasks is precisely the count-is-a-lie the case rules out.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tasks;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const pages = tasks.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap(p => p.items), [pages]);
  const unreadable = pages[pages.length - 1]?.unreadable ?? [];

  const lookups = useMemo(
    () =>
      buildLookups({
        projects: projects.data?.items ?? [],
        users: users.data?.items ?? [],
        labels: labels.data?.items ?? [],
        workflow: workflow.data,
      }),
    [projects.data, users.data, labels.data, workflow.data],
  );

  const sprintDefs: readonly SprintDef[] = sprints.data?.items ?? [];

  const columns = useMemo(
    () => deriveSprintColumns(sprintDefs, items),
    [sprintDefs, items],
  );
  const buckets = useMemo(() => bucketBySprint(columns, items), [columns, items]);

  // The workspace's date, not the browser's — SPR-20's hint compares
  // against the tracker's calendar, so a user in another timezone must
  // not see a different set of overrun sprints than the CLI reports.
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  const cardLayout = useMemo(
    () => resolveCardLayout(userSettings.data?.settings),
    [userSettings.data?.settings],
  );

  // SPR-3: per-browser, read once at mount. Not React Query state —
  // it is not the server's, and V12 put it in localStorage.
  const [overrides, setOverrides] = useState<CollapseOverrides>(() => readOverrides());
  const toggleColumn = useCallback((column: SprintColumn) => {
    setOverrides(prev => {
      const next = toggle(column, prev);
      writeOverrides(next);
      return next;
    });
  }, []);

  // SPR-5/SPR-36: a rejected write names the task, the target sprint,
  // and says plainly that the assignment was not saved.
  const [moveError, setMoveError] = useState<{
    key: string;
    sprintLabel: string;
    message: string;
  } | null>(null);

  /**
   * The write, per task.
   *
   * `useSetField` is keyed on the task ref, so the hook cannot be
   * called once for a whole view. The mutation is created on demand
   * inside `runMove` via the query client the hook closes over —
   * except hooks cannot be called conditionally, so instead a single
   * hook instance is created with a ref that the drop rewrites. That
   * would violate the rules of hooks too.
   *
   * So the drop calls the endpoint through the *same* mutation the
   * meta panel uses, obtained from a stable child component. See
   * `SprintWriter` below — the drop is queued into it.
   */
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const lastMove = useRef<PendingWrite | null>(null);

  const runMove = useCallback((taskKey: string, columnId: string): void => {
    const column = columns.find(c => c.id === columnId);
    if (column === undefined) return;
    // SPR-27's columns are a diagnosis, not a destination: dropping a
    // card into "Unknown sprint" would mean writing a sprint id that
    // does not exist, which core refuses anyway (A49).
    if (column.kind === "unknown") return;
    const write: PendingWrite = {
      ref: taskKey,
      // SPR-4: the sprint's `id`, never its `name`. SPR-6: clearing
      // is `undefined`, which `useSetField` sends as an *unset* —
      // the key is removed rather than written as "" or "none".
      value: column.kind === "none" ? undefined : column.id,
      sprintLabel: column.kind === "none" ? "No sprint" : column.label,
    };
    lastMove.current = write;
    setMoveError(null);
    setPending(write);
  }, [columns]);

  const { drag, onPointerDown } = useBoardDrag<SprintColumn>({
    columns,
    buckets,
    // The hook speaks in `status`; here the value is the sprint id and
    // the column id is what `runMove` needs. Both are the column's id,
    // so the identity function is honest rather than a coincidence.
    fieldForColumn: c => c.id,
    onDrop: (req: DropRequest) => {
      // `status` carries the destination column id (see the hook's
      // `fieldForColumn` note). Absent means the card stayed inside
      // its own column, and a same-column drop reassigns nothing —
      // SPR-4's last bullet requires no write at all, and there is no
      // ordering here for an intra-column drop to change.
      if (req.status === undefined) return;
      runMove(req.key, req.status);
    },
  });

  const draggedTask = useMemo(
    () => (drag === null ? undefined : items.find(t => t.key === drag.key)),
    [drag, items],
  );

  // A `workflow.yaml` the loader refuses takes `/api/tasks` with it,
  // so there is no task list to draw. Checked before anything that
  // needs one.
  const configError = configInvalidOf(workflow.error) ?? configInvalidOf(tasks.error);
  if (configError !== null) {
    return (
      <ConfigErrorState
        error={configError}
        onRetry={() => {
          void workflow.refetch();
          void tasks.refetch();
        }}
      />
    );
  }

  // SPR-31: a malformed `sprints.yaml`. Core attributes this itself —
  // `SprintsConfigError` sets `config_invalid` in its constructor and
  // the dispatcher maps it to a 400 naming the file, the offending
  // sprint and the broken rule (A50, measured). The message is shown
  // verbatim; a second parser here would drift from core's.
  //
  // A48: the parse is all-or-nothing. There is no "valid subset" to
  // fall back to, so this must never degrade into an empty state that
  // reads as "no sprints" — which is exactly what SPR-32 forbids.
  const sprintsConfigError = configInvalidOf(sprints.error);
  if (sprintsConfigError !== null) {
    return (
      <div className="p-4" data-testid="sprints-config-error">
        <div
          role="alert"
          className="mx-auto max-w-2xl rounded-md border border-danger-fg/30 bg-danger-fg/5 p-4"
        >
          <h2 className="text-[15px] font-semibold text-text-primary">
            The sprint configuration could not be read
          </h2>
          <p className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-danger-fg">
            {sprintsConfigError.envelope?.message ?? sprintsConfigError.message}
          </p>
          <p className="mt-3 text-[13px] text-text-secondary">
            No sprints could be loaded — the whole file failed to parse, so
            this is not an empty tracker. Fix{" "}
            <code className="font-mono">.loctt/config/sprints.yaml</code> and
            reload. LocTT will not repair the file for you.
          </p>
        </div>
      </div>
    );
  }

  const loading = tasks.isLoading || sprints.isLoading;

  // SPR-32's second half: a *failed* fetch is an error with a retry,
  // never the empty state. Distinguished from the config error above,
  // which is a 400 the user must fix rather than retry.
  if (!loading && (tasks.isError || sprints.isError)) {
    return (
      <div className="p-4" data-testid="sprints-load-error">
        <ErrorState
          error={sprints.error ?? tasks.error}
          context="Could not load sprints"
          onRetry={() => {
            void sprints.refetch();
            void tasks.refetch();
          }}
        />
      </div>
    );
  }

  const realColumns = columns.filter(c => c.kind === "sprint");

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="sprints">
      {pending !== null && (
        <SprintWriter
          write={pending}
          onDone={() => { setPending(null); }}
          onError={(err, write) => {
            setPending(null);
            setMoveError({
              key: write.ref,
              sprintLabel: write.sprintLabel,
              message:
                err instanceof ApiError
                  ? err.envelope?.message ?? err.message
                  : "The server could not be reached.",
            });
          }}
        />
      )}

      {/* SPR-5 / SPR-36: names the task, the target sprint, and says
          plainly that the assignment was not saved. The card is
          already back in its source column — `useSetField` rolls the
          optimistic cache write back on error, so nothing the browser
          invented survives this (P1). */}
      {moveError !== null && (
        <div
          role="alert"
          data-testid="sprints-move-error"
          className="flex items-center gap-3 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          <span className="min-w-0 flex-1">
            <strong>{moveError.key}</strong> was not moved to{" "}
            <strong>{moveError.sprintLabel}</strong> — the assignment was not
            saved. {moveError.message}
          </span>
          <button
            type="button"
            data-testid="sprints-move-retry"
            onClick={() => {
              const req = lastMove.current;
              if (req !== null) { setMoveError(null); setPending(req); }
            }}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Retry
          </button>
          <button
            type="button"
            data-testid="sprints-move-reload"
            onClick={() => { window.location.reload(); }}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Reload
          </button>
        </div>
      )}

      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="sprints-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so {unreadable.length === 1 ? "it is" : "they are"}
          {" "}missing from this view. Check the file.
        </div>
      )}

      {/* SPR-32: zero sprints is an empty state that SAYS there are no
          sprints and points at Settings → Sprints. Reached only when
          the fetch succeeded — a failed load and a parse failure both
          returned above, which is what makes the three
          distinguishable. */}
      {!loading && realColumns.length === 0 && (
        <div
          data-testid="sprints-empty"
          className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[13px] text-text-tertiary"
        >
          No sprints yet.{" "}
          <button
            type="button"
            onClick={() => void navigate({ to: "/settings/$section", params: { section: "sprints" } })}
            className="underline underline-offset-2 hover:text-text-primary"
          >
            Settings → Sprints
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full items-start gap-3">
          {columns.map(column => (
            <Column
              key={column.id}
              column={column}
              tasks={buckets.get(column.id) ?? []}
              expanded={isExpanded(column, overrides)}
              onToggle={() => { toggleColumn(column); }}
              layout={cardLayout}
              lookups={lookups}
              milestones={milestones.data?.items ?? []}
              sprints={sprintDefs}
              loading={loading}
              today={today}
              onOpen={key => void navigate({ to: "/tasks/$key", params: { key } })}
              drag={drag}
              onCardPointerDown={onPointerDown}
            />
          ))}
          {/* One column must not stretch into a full-width slab. */}
          <div className="min-w-0 flex-1" aria-hidden="true" />
        </div>
      </div>

      {drag !== null && draggedTask !== undefined && (
        <div
          data-testid="sprints-drag-preview"
          className="pointer-events-none fixed z-50 rotate-2 opacity-90 shadow-lg"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
          }}
        >
          <BoardCard
            task={draggedTask}
            layout={cardLayout}
            lookups={lookups}
            milestones={milestones.data?.items ?? []}
            sprints={sprintDefs}
            today={today}
            onOpen={() => undefined}
            onFilterLabel={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Page size for a sprints read. The server's `limit` ceiling, so this
 * is one request per 200 tasks — matching the board's reasoning.
 */
const SPRINTS_PAGE_SIZE = 200;

interface PendingWrite {
  readonly ref: string;
  /** The sprint `id`, or `undefined` to unset the field (SPR-6). */
  readonly value: string | undefined;
  /** For the error message (SPR-5). */
  readonly sprintLabel: string;
}

/**
 * Issues one `sprint` write.
 *
 * A component rather than a call because `useSetField` is keyed on the
 * task ref, and a hook cannot be called with a ref that changes per
 * drop without breaking the rules of hooks. Mounting one of these per
 * pending write gives each its own correctly-keyed mutation, and its
 * optimistic rollback (SPR-5) lands on the right task's cache entry.
 */
function SprintWriter({
  write,
  onDone,
  onError,
}: {
  readonly write: PendingWrite;
  readonly onDone: () => void;
  readonly onError: (err: unknown, write: PendingWrite) => void;
}) {
  const setField = useSetField(write.ref);
  const fired = useRef(false);

  if (!fired.current) {
    fired.current = true;
    setField.mutate(
      // SPR-6: `value: undefined` is an *unset* — the key is removed
      // from frontmatter rather than written as "" or the literal
      // "none", so the task matches `sprint` being unset in the query
      // language, consistently with what the CLI reports.
      { field: "sprint", ...(write.value !== undefined ? { value: write.value } : {}) },
      {
        onSuccess: () => { onDone(); },
        onError: (err: unknown) => { onError(err, write); },
      },
    );
  }
  return null;
}

/** Pulls a `config_invalid` envelope off a query error, if that is what it is. */
function configInvalidOf(error: unknown): ApiError | null {
  return error instanceof ApiError && error.envelope?.code === "config_invalid"
    ? error
    : null;
}

function Column({
  column,
  tasks,
  expanded,
  onToggle,
  layout,
  lookups,
  milestones,
  sprints,
  loading,
  today,
  onOpen,
  drag,
  onCardPointerDown,
}: {
  readonly column: SprintColumn;
  readonly tasks: readonly TaskFrontmatterPublic[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly layout: readonly CardLayoutField[];
  readonly lookups: ReturnType<typeof buildLookups>;
  readonly milestones: readonly { id: string; name: string }[];
  readonly sprints: readonly { id: string; name: string }[];
  readonly loading: boolean;
  readonly today: string;
  readonly onOpen: (key: string) => void;
  readonly drag: DragState | null;
  readonly onCardPointerDown: (
    e: React.PointerEvent,
    key: string,
    columnId: string,
    originNeighbours: DropNeighbours,
  ) => void;
}) {
  const active = column.kind === "sprint" && isActive(column.sprint as SprintDef);
  const overrun = column.kind === "sprint"
    && windowDisagrees(column.sprint as SprintDef, today);
  const isDropTarget = drag !== null && drag.over?.columnId === column.id;
  const draggingKey = drag?.key;
  const dropIndex = isDropTarget ? drag.over?.index : undefined;

  return (
    <section
      data-testid={`sprint-column-${column.id}`}
      // The drag resolves the column under the pointer from this
      // attribute, so it must cover the whole column, header included.
      data-column-id={column.id}
      data-active={active ? "true" : undefined}
      data-drop-active={isDropTarget ? "true" : undefined}
      aria-label={column.label}
      className={[
        "flex w-[280px] shrink-0 flex-col rounded-md border bg-bg-surface transition-colors",
        expanded ? "h-full" : "h-auto",
        isDropTarget
          ? "border-accent-fg ring-1 ring-accent-fg/40"
          // SPR-2: the active column's highlight is not colour alone —
          // it carries a heavier border AND the "Active" pill below,
          // so it is distinguishable without relying on hue.
          : active
            ? "border-accent-fg/70 border-l-4"
            : "border-border-subtle",
      ].join(" ")}
    >
      <header className="border-b border-border-subtle">
        <button
          type="button"
          data-testid={`sprint-toggle-${column.id}`}
          onClick={onToggle}
          // SPR-2's "clicking a collapsed header expands it in place".
          // A real button so it is keyboard-reachable, and
          // `aria-expanded` so the state is announced rather than
          // inferred from a chevron (flow-accessibility).
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0">
            {/* SPR-1: the sprint `name` as written in config. Never the
                ULID, never a slug. */}
            <span
              data-testid={`sprint-name-${column.id}`}
              className="block truncate text-[13px] font-semibold text-text-primary"
              title={column.label}
            >
              {column.label}
            </span>
            {/* SPR-1's date window, and SPR-24's discriminator: two
                sprints may share a `name`, and this is how the user
                tells them apart. */}
            {column.sprint !== undefined && (
              <span
                data-testid={`sprint-window-${column.id}`}
                className="block truncate font-mono text-[10px] text-text-tertiary"
              >
                {column.sprint.start_date} → {column.sprint.end_date}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {active && (
              <span className="rounded-full bg-accent-fg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-fg">
                Active
              </span>
            )}
            {/* SPR-1 / SPR-15 / SPR-17: the true total, and an explicit
                `0` on an empty column. Not the number of rendered
                cards — SPR-17's column virtualizes. */}
            <span
              data-testid={`sprint-count-${column.id}`}
              className="rounded px-1.5 py-0.5 text-[11px] tabular-nums text-text-tertiary"
            >
              {loading ? "–" : tasks.length}
            </span>
          </span>
        </button>
      </header>

      {/* SPR-20: the window is in the past while the state says active.
          An informational hint — not an error, and nothing here
          rewrites `state`. */}
      {overrun && expanded && (
        <p
          data-testid={`sprint-window-hint-${column.id}`}
          className="border-b border-border-subtle px-3 py-2 text-[11px] text-text-secondary"
        >
          This sprint is still marked <strong>active</strong>, but its dates
          ({column.sprint?.start_date} → {column.sprint?.end_date}) do not
          include today. LocTT does not change sprint state on its own.
        </p>
      )}

      {/* SPR-27: names the dangling id, so the user can find it. The
          rest of the view keeps rendering around it. */}
      {column.kind === "unknown" && expanded && (
        <p
          data-testid={`sprint-unknown-${column.id}`}
          className="border-b border-border-subtle px-3 py-2 text-[11px] text-text-secondary"
        >
          These tasks name a sprint that{" "}
          <code className="font-mono">sprints.yaml</code> does not define:{" "}
          <code className="font-mono" data-testid={`sprint-missing-id-${column.id}`}>
            {column.missingId}
          </code>
          .
        </p>
      )}

      {expanded && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : tasks.length === 0 ? (
            // SPR-15: a designed empty state, not a zero-height column
            // that collapses into its neighbour. Still a drop target —
            // it is inside the `data-column-id` section.
            <p
              data-testid={`sprint-placeholder-${column.id}`}
              className="rounded border border-dashed border-border-subtle px-3 py-6 text-center text-[12px] text-text-tertiary"
            >
              {column.kind === "none"
                ? "No unassigned tasks"
                : `No tasks in ${column.label}`}
            </p>
          ) : (
            <VirtualCards
              tasks={tasks}
              dropIndex={dropIndex}
              renderCard={(task, i) => (
                <Fragment key={task.id}>
                  <DropIndicator active={dropIndex === i} />
                  <BoardCard
                    task={task}
                    layout={layout}
                    lookups={lookups}
                    milestones={milestones}
                    sprints={sprints}
                    today={today}
                    placeholder={task.key === draggingKey}
                    onOpen={onOpen}
                    onFilterLabel={() => undefined}
                    onPointerDown={e => {
                      onCardPointerDown(
                        e,
                        task.key,
                        column.id,
                        neighboursAt(tasks.filter(t => t.key !== task.key), i),
                      );
                    }}
                  />
                </Fragment>
              )}
              trailing={<DropIndicator active={dropIndex === tasks.length} />}
            />
          )}
        </div>
      )}
    </section>
  );
}

function DropIndicator({ active }: { readonly active: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-testid="sprint-drop-indicator"
      data-active={active ? "true" : "false"}
      className={[
        "overflow-hidden rounded transition-all duration-150",
        active ? "my-1 h-10 border-2 border-dashed border-accent-fg bg-accent-fg/10" : "h-0",
      ].join(" ")}
    />
  );
}

function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      data-testid="sprint-skeleton"
      className="h-16 animate-pulse rounded border border-border-subtle bg-bg-muted"
    />
  );
}
