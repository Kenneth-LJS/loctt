import type { BrokenEntry, CardLayoutField, SprintDef, TaskFrontmatterPublic } from "@loctt/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "../api/hooks/sidebarData.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { useSetField } from "../api/hooks/useSetField.ts";
import { useSprintsWithProgress } from "../api/hooks/useSprintDetail.ts";
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
import type { Progress, Readout } from "../milestones/model.ts";
import { progressState } from "../milestones/model.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Chip } from "../ui/Chip.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import type { CollapseOverrides } from "./collapse.ts";
import { isExpanded, readOverrides, toggle, writeOverrides } from "./collapse.ts";
import type { SprintColumn } from "./columns.ts";
import {
  bucketBySprint,
  deriveSprintColumns,
  isActive,
  sprintCountdown,
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

  // SPR-39 (F1/K30): the done/total per sprint, from core via
  // `?progress=true` — the exact number the detail page and the CLI
  // report. Surfaced on each overview card as a mini-bar (A165) so the
  // overview and the detail cannot disagree. Its own query key, so a
  // failure here degrades the at-a-glance readout without blanking the
  // columns or the drag surface.
  const sprintsProgress = useSprintsWithProgress();

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

  // A138 wire: `GET /api/sprints` rides a `broken` list — sprint entries
  // in `sprints.yaml` whose fields no longer validate (a hand edit, most
  // often). Core degrades the READ (the good sprints still load), so this
  // view MUST surface the broken ones rather than let them vanish
  // silently (corruption-sweep § "surface it, don't hide it"; the same
  // treatment Sidebar gives a broken saved view). The shared
  // `useSprints` hook (api/hooks/sidebarData.ts) does not yet type
  // `broken` on its `Page<SprintDef>`; reading it through a narrow
  // accessor here keeps the wire contract honest without editing a hook
  // another agent owns. See the REPORT note in the handoff.
  const brokenSprints: readonly BrokenEntry[] = brokenOf(sprints.data);

  // SPR-1 / SPR-40: archived sprints are hidden by default and revealed
  // by an explicit affordance — the overview's half of archive/unarchive
  // parity (A166). A local view toggle only: it never writes, and
  // `deriveSprintColumns` already took the option nothing was passing.
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = sprintDefs.filter(s => s.archived === true).length;

  // SPR-39: `progress` off the `?progress=true` list, keyed by id, so the
  // header can look up its own done/total. A missing entry (an older
  // server, or the progress query still in flight) yields `undefined`,
  // which `progressState` renders as "unavailable" rather than a
  // fabricated 0/0.
  const progressById = useMemo(() => {
    const m = new Map<string, Progress | undefined>();
    for (const s of sprintsProgress.data?.items ?? []) m.set(s.id, s.progress);
    return m;
  }, [sprintsProgress.data]);

  const columns = useMemo(
    () => deriveSprintColumns(sprintDefs, items, { showArchived }),
    [sprintDefs, items, showArchived],
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
          <h2 className="text-[1.0714rem] font-semibold text-text-primary">
            The sprint configuration could not be read
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[0.8571rem] text-danger-fg">
            {sprintsConfigError.envelope?.message ?? sprintsConfigError.message}
          </p>
          <p className="mt-3 text-[0.9286rem] text-text-secondary">
            No sprints could be loaded — the whole file failed to parse, so
            this is not an empty tracker. Fix{" "}
            <code>.loctt/config/sprints.yaml</code> and
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
      <div data-testid="sprints-load-error">
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
      {/* SPR-40: the overview's lifecycle affordances (A166). Create,
          delete and archive *act* in Settings → Sprints (the shared
          RemapDeleteDialog, so the two surfaces cannot drift); the
          overview links there in one click, and reveals archived
          sprints in place with a local view toggle that never writes. */}
      <header className="flex items-center justify-between gap-3">
        <Link
          to="/settings/$section"
          params={{ section: "sprints" }}
          data-testid="sprints-manage-link"
          className="text-[0.8571rem] text-accent no-underline hover:underline"
        >
          Manage sprints in Settings →
        </Link>
        {archivedCount > 0 && (
          // SPR-1: archived sprints appear only behind this affordance.
          // A checkbox so the state is announced; nothing here writes to
          // sprints.yaml (unarchiving is a Settings action).
          <label className="flex items-center gap-1.5 text-[0.8571rem] text-text-secondary">
            <Checkbox
              data-testid="sprints-show-archived"
              checked={showArchived}
              onChange={e => { setShowArchived(e.target.checked); }}
            />
            Show archived ({archivedCount})
          </label>
        )}
      </header>

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
          className="flex items-center gap-3 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
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

      {/* A138 / corruption-sweep: broken `sprints.yaml` entries surfaced,
          not dropped. Distinct from the *whole-file* parse failure above
          (which returns an error page): here the file parsed, most
          sprints loaded, and one or more entries are individually
          corrupt. Named, marked ⚠, and shown even when there are healthy
          sprints — the same "one bad entry never blanks the surface"
          contract Sidebar honours for a broken saved view. */}
      {brokenSprints.length > 0 && (
        <div
          role="alert"
          data-testid="sprints-broken-config"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          <p className="font-medium">
            {brokenSprints.length === 1
              ? "1 sprint could not be read from sprints.yaml"
              : `${String(brokenSprints.length)} sprints could not be read from sprints.yaml`}
            {" "}— fix{" "}
            <code>.loctt/config/sprints.yaml</code> and
            reload to restore {brokenSprints.length === 1 ? "it" : "them"}.
            LocTT will not repair the file for you.
          </p>
          <ul className="mt-1.5 space-y-1">
            {brokenSprints.map(b => (
              <li
                key={b.id ?? `index-${String(b.index)}`}
                data-testid={`sprint-broken-${b.id ?? `index-${String(b.index)}`}`}
                data-broken-sprint={b.id ?? `index-${String(b.index)}`}
                className="flex items-start gap-1.5"
              >
                <span aria-hidden="true" className="shrink-0">⚠</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {/* Name the entry: its id when the loader could read
                        one, otherwise its position in the file (BrokenEntry
                        drops `id` only when the id itself is what failed). */}
                    {b.id ?? `Sprint entry #${String(b.index + 1)}`}
                  </span>
                  <span className="text-text-tertiary"> (broken)</span>
                  <span className="mt-0.5 block break-words text-[0.7857rem] text-danger-fg/90">
                    {b.error}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="sprints-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
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
      {/* `brokenSprints.length === 0` guard (A138 "tell broken from
          none"): a tracker whose only sprint is corrupt has zero *valid*
          columns, but it is not empty — the broken-config notice above
          already explains it, and claiming "No sprints yet" here would
          contradict that and hide the corruption. */}
      {!loading && realColumns.length === 0 && brokenSprints.length === 0 && (
        <div
          data-testid="sprints-empty"
          className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[0.9286rem] text-text-tertiary"
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
              progress={column.kind === "sprint" ? progressById.get(column.id) : undefined}
              onOpen={key => void navigate({ to: "/tasks/$key", params: { key } })}
              onOpenSprint={key => void navigate({ to: "/sprints/$key", params: { key } })}
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

/**
 * The `broken` list off the sprints response, if the server sent one.
 *
 * `GET /api/sprints` rides a `broken: BrokenEntry[]` (A138), omitted when
 * every entry parsed. The shared `useSprints` hook types its result as
 * `Page<SprintDef>` and does not (yet) surface `broken`, so this reads it
 * through a narrow structural check rather than a blind cast — an older
 * server, or a clean file, simply has no `broken` and yields `[]`.
 */
function brokenOf(data: unknown): readonly BrokenEntry[] {
  if (data === null || typeof data !== "object") return [];
  const b = (data as { broken?: unknown }).broken;
  return Array.isArray(b) ? (b as readonly BrokenEntry[]) : [];
}

/** Pulls a `config_invalid` envelope off a query error, if that is what it is. */
function configInvalidOf(error: unknown): ApiError | null {
  return error instanceof ApiError && error.envelope?.code === "config_invalid"
    ? error
    : null;
}

/**
 * The controls that own their own click inside the at-a-glance card
 * (SPR-39). A click that `closest`-matches one of these is handled by
 * that control, not by the card's navigate — so the "Open sprint" link
 * and the collapse toggle never double-fire the card. Kept as a string
 * so it degrades gracefully as controls are added.
 */
const INTERACTIVE_WITHIN_CARD = "a, button, input, select, textarea, label, [role='button']";

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
  progress,
  onOpen,
  onOpenSprint,
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
  /** SPR-39: this sprint's core progress, for the at-a-glance mini-bar. */
  readonly progress: Progress | undefined;
  readonly onOpen: (key: string) => void;
  /** SPR-39 / K-14: open the sprint's detail from the at-a-glance card. */
  readonly onOpenSprint: (key: string) => void;
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

  // SPR-39: the at-a-glance readout, from the same core `Progress` the
  // detail page shows. `progressState` turns a missing/zero-denominator
  // entry into an explicit "No tasks"/"unavailable" rather than a
  // fabricated 0/0.
  const readout: Readout = progressState(progress);
  const countdown = column.kind === "sprint"
    ? sprintCountdown((column.sprint as SprintDef).end_date, today)
    : undefined;
  const overdue = countdown !== undefined && countdown.endsWith("overdue");

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
        // S-11: the fixed `w-[280px]` overflowed the body on a phone.
        // Cap to most of the viewport on narrow screens (the row still
        // h-scrolls inside its own container), settling to 280px from
        // the `sm` breakpoint up.
        "flex w-[85vw] max-w-[280px] shrink-0 flex-col rounded-md border bg-bg-surface transition-colors sm:w-[280px]",
        expanded ? "h-full" : "h-auto",
        isDropTarget
          ? "border-accent ring-1 ring-accent/40"
          // SPR-2: the active column's highlight is not colour alone —
          // it carries a heavier border AND the "Active" pill below,
          // so it is distinguishable without relying on hue.
          : active
            ? "border-accent/70 border-l-4"
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
              className="block truncate text-[0.9286rem] font-semibold text-text-primary"
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
                className="block truncate text-[0.7143rem] text-text-tertiary"
              >
                {column.sprint.start_date} → {column.sprint.end_date}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {active && (
              // K-6/S-11: the B1 Chip, not a hand-rolled pill. SPR-2's
              // "distinguishable without relying on hue" holds — it is a
              // labelled chip AND the heavier column border.
              <Chip variant="accent" shape="pill">
                <span className="text-[0.7143rem] font-semibold uppercase">Active</span>
              </Chip>
            )}
            {/* SPR-1 / SPR-15 / SPR-17: the true total, and an explicit
                `0` on an empty column. Not the number of rendered
                cards — SPR-17's column virtualizes. `data-testid` is on
                the Chip's own element via `testId` (declared, not
                spread), so the count locator resolves unchanged. */}
            <Chip variant="count" testId={`sprint-count-${column.id}`}>
              {loading ? "–" : tasks.length}
            </Chip>
          </span>
        </button>

        {/* SPR-39 / K-14: the at-a-glance card. The whole block opens the
            sprint's detail (progress, dates, days-remaining, and a
            mini-bar that is the "burndown equivalent" — the real chart is
            one Open-away, A165). It is a sibling of the toggle, not a
            child: the header button owns the collapse gesture (SPR-2),
            and nesting a navigable region in a button is invalid.

            The at-a-glance *data* (mini-bar + countdown) shows only when
            the column is expanded — SPR-2 keeps a collapsed column to
            "header plus task count only", and expanding is one click of
            the toggle above. The Open-sprint link stays visible either
            way, so SPR-7's navigate affordance is never hidden.

            Only real sprints have a detail page — the "No sprint" bucket
            and a dangling-id column are not rows in `sprints.yaml`.

            A click that landed on an inner control (the explicit "Open
            sprint" link) is that control's, not the card's — `closest`
            walks up from the actual target, so the two never
            double-navigate. Keyboard-operable and announced as a link,
            so the affordance is not mouse-only. */}
        {column.kind === "sprint" && (
          <div
            data-testid={`sprint-card-${column.id}`}
            data-overdue={overdue ? "true" : "false"}
            role="link"
            tabIndex={0}
            aria-label={`Open ${column.label}`}
            onClick={(e: MouseEvent<HTMLElement>) => {
              if ((e.target as Element).closest(INTERACTIVE_WITHIN_CARD) !== null) return;
              onOpenSprint(column.id);
            }}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                if ((e.target as Element).closest(INTERACTIVE_WITHIN_CARD) !== null) return;
                e.preventDefault();
                onOpenSprint(column.id);
              }
            }}
            className="cursor-pointer px-3 pb-2 transition-colors hover:bg-bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--text-primary)]"
          >
            {/* SPR-39: progress done/total from core, as a compact
                mini-bar. Same numbers as the detail page. Expanded only
                (SPR-2). */}
            {expanded && <SprintMiniProgress readout={readout} columnId={column.id} />}

            <div className="mt-1 flex items-center justify-between gap-2">
              {/* SPR-39: days-remaining, or overdue once the window has
                  passed (the SPR-20 disagreement, read as a countdown).
                  Expanded only, so a collapsed column stays minimal. */}
              {expanded && countdown !== undefined && (
                <span
                  data-testid={`sprint-countdown-${column.id}`}
                  className={[
                    "text-[0.7857rem] tabular-nums",
                    overdue ? "font-medium text-danger-fg" : "text-text-tertiary",
                  ].join(" ")}
                >
                  {countdown}
                </span>
              )}
              {/* SPR-7: the explicit navigate affordance is kept — a real
                  anchor, so middle-click / open-in-new-tab work, and it
                  stays visible whether the column is expanded or not. The
                  surrounding card is also clickable (SPR-39); the card
                  handler ignores clicks that originate here. */}
              <Link
                to="/sprints/$key"
                params={{ key: column.id }}
                data-testid={`sprint-open-${column.id}`}
                className="ml-auto text-[0.7857rem] text-accent no-underline hover:underline"
              >
                Open sprint →
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* SPR-20: the window is in the past while the state says active.
          An informational hint — not an error, and nothing here
          rewrites `state`. */}
      {overrun && expanded && (
        <p
          data-testid={`sprint-window-hint-${column.id}`}
          className="border-b border-border-subtle px-3 py-2 text-[0.7857rem] text-text-secondary"
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
          className="border-b border-border-subtle px-3 py-2 text-[0.7857rem] text-text-secondary"
        >
          These tasks name a sprint that{" "}
          <code>sprints.yaml</code> does not define:{" "}
          <code data-testid={`sprint-missing-id-${column.id}`}>
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
              className="rounded border border-dashed border-border-subtle px-3 py-6 text-center text-[0.8571rem] text-text-tertiary"
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

/**
 * The at-a-glance progress mini-bar (SPR-39).
 *
 * The "mini-burndown or equivalent" the case asks for (A165): a compact
 * bar + `done / total` from the same core `Progress` the detail page
 * renders — reusing `progressState`, so the overview and the detail can
 * never show two different numbers for the same sprint. The literal
 * burndown chart stays on the detail page (`Open sprint →`).
 *
 * `unavailable` (progress query in flight or failed) shows nothing
 * rather than a fabricated 0/0; `none` (no counted tasks) shows an
 * explicit "No tasks", never `0/0` or `NaN%` (mirrors MSL-15).
 */
function SprintMiniProgress({
  readout,
  columnId,
}: {
  readonly readout: Readout;
  readonly columnId: string;
}) {
  if (readout.kind === "unavailable") return null;

  return (
    <div
      data-testid={`sprint-progress-${columnId}`}
      className="flex items-center gap-2"
    >
      <div
        data-testid={`sprint-progress-bar-${columnId}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={readout.total}
        aria-valuenow={readout.done}
        aria-label="Sprint progress"
        data-fill={readout.fill.toFixed(4)}
        className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-bg-muted"
      >
        <div
          data-testid={`sprint-progress-bar-fill-${columnId}`}
          className={[
            "h-full rounded-full transition-[width]",
            readout.complete ? "bg-success-fg" : "bg-accent",
          ].join(" ")}
          style={{ width: `${String(readout.fill * 100)}%` }}
        />
      </div>
      {readout.kind === "none" ? (
        <span className="shrink-0 text-[0.7857rem] text-text-tertiary">No tasks</span>
      ) : (
        <span className="shrink-0 text-[0.7857rem] tabular-nums text-text-secondary">
          {readout.done}/{readout.total}
          {readout.percent !== undefined && (
            <span className="ml-1 text-text-tertiary">({readout.percent}%)</span>
          )}
        </span>
      )}
    </div>
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
        active ? "my-1 h-10 border-2 border-dashed border-accent bg-accent/10" : "h-0",
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
