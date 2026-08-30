import type { CardLayoutField, TaskFrontmatterPublic } from "@loctt/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "../api/hooks/sidebarData.ts";
import { useBoardMove } from "../api/hooks/useBoardMove.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { buildLookups } from "../list/lookups.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { BoardCard } from "./BoardCard.tsx";
import { resolveCardLayout } from "./cardLayout.ts";
import { hiddenColumnsOf, withHiddenColumns } from "./chipSettings.ts";
import type { BoardColumn } from "./columns.ts";
import { bucketTasks, deriveColumns } from "./columns.ts";
import { ConfigErrorState } from "./ConfigErrorState.tsx";
import type { DropNeighbours } from "./dragModel.ts";
import { neighboursAt, statusForColumn } from "./dragModel.ts";
import type { DragState, DropRequest } from "./useBoardDrag.ts";
import { useBoardDrag } from "./useBoardDrag.ts";

/**
 * The board (M3.1 static shape; M3.2 adds the drag layer).
 *
 * Cards are dragged between and within columns. The two writes are
 * deliberately different shapes: crossing a column boundary sends
 * `status` and `board_rank` in ONE request (BRD-9, XS-9), while a
 * reorder inside a column sends `board_rank` alone, with `status`
 * absent from the payload rather than resent at its current value.
 * See `useBoardMove` for why the two-request version is a defect.
 *
 * The board reads the *same* URL search vocabulary as the list
 * (BRD-1, BRD-14), so a filter is expressed identically in both and a
 * pasted `/board?assignee=…` reproduces the filtered board.
 */
export function BoardView() {
  const search = useSearch({ from: "/board" });
  const navigate = useNavigate({ from: "/board" });

  // The board shows a whole column, not a page of one. The list's
  // 50-row default would silently truncate every column and make the
  // header counts lie (BRD-21 wants the true total). The feed pages
  // underneath; `limit` just makes each page big.
  const params = useMemo(
    () => ({ ...tasksParamsFromSearch(search), limit: BOARD_PAGE_SIZE }),
    [search],
  );
  const tasks = useTasksFeed(params);

  const workflow = useWorkflow();
  const info = useInfo();
  const userSettings = useUserSettings();
  const settingsWrite = useUserSettingsMutation();

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();

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

  const pages = tasks.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap(p => p.items), [pages]);
  const unreadable = pages[pages.length - 1]?.unreadable ?? [];
  const total = pages[pages.length - 1]?.total ?? 0;

  // The board exhausts the feed on its own.
  //
  // The list stops at a page and offers "Load more"; a board has no
  // such control and no place to put one — a column is a column, not a
  // page of one. Left to stop at the first page, a 900-task status
  // rendered its first 200 cards under a header reading "200", which
  // is precisely the page-size-as-total that BRD-21's first bullet
  // rules out, and it would make the board disagree with the list's
  // count for the same filter (BRD-24).
  //
  // Measured before this existed: header `200`, 900 tasks on disk.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tasks;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const columns = useMemo(
    () => deriveColumns(workflow.data, items),
    [workflow.data, items],
  );
  const buckets = useMemo(() => bucketTasks(columns, items), [columns, items]);

  // The workspace's date, not the browser's — the same source the
  // list uses, so both views agree on which cards are overdue.
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  const cardLayout = useMemo(
    () => resolveCardLayout(userSettings.data?.settings),
    [userSettings.data?.settings],
  );

  const hidden = useMemo(
    () => hiddenColumnsOf(userSettings.data?.settings),
    [userSettings.data?.settings],
  );

  // Computed before the drag hook because hooks cannot run behind an
  // early return, and the drag needs to know which columns are
  // actually rendered (BRD-36).
  const visible = useMemo(
    () => columns.filter(c => !hidden.includes(c.id)),
    [columns, hidden],
  );

  // BRD-48: the write can fail. The optimistic hide is rolled back by
  // the mutation, so the board and the file agree again — this is what
  // tells the user why the column came back.
  const [chipError, setChipError] = useState<unknown>(null);

  // BRD-41/BRD-43/BRD-44: a failed drop must name the task, say the
  // move was not saved, and offer a retry. `lastMove` keeps the
  // arguments so the retry can re-issue exactly the same write rather
  // than asking the user to drag again.
  const [moveError, setMoveError] = useState<{ key: string; message: string } | null>(null);
  const lastMove = useRef<DropRequest | null>(null);

  const boardMove = useBoardMove();

  const runMove = useCallback((req: DropRequest): void => {
    lastMove.current = req;
    setMoveError(null);
    boardMove.mutate(
      {
        ref: req.key,
        ...(req.status !== undefined ? { status: req.status } : {}),
        ...(req.before !== undefined ? { before: req.before } : {}),
        ...(req.after !== undefined ? { after: req.after } : {}),
      },
      {
        onError: (err: unknown) => {
          setMoveError({
            key: req.key,
            message:
              err instanceof ApiError
                ? err.envelope?.message ?? err.message
                : "The server could not be reached.",
          });
        },
      },
    );
  }, [boardMove]);

  const { drag, onPointerDown } = useBoardDrag({
    columns: visible,
    buckets,
    onDrop: runMove,
  });

  // BRD-38: the same move without a mouse.
  //
  // The documented sequence is Ctrl/Cmd + arrow on a focused card:
  // Left/Right move it to the adjacent column, Up/Down move it within
  // its own column. Plain arrows are left alone so they still scroll
  // the column and move between focusable controls.
  //
  // This funnels into `runMove` — the same request a mouse drag makes,
  // so the atomic single write of BRD-9 is not reimplemented for the
  // keyboard and cannot drift from it.
  const [announcement, setAnnouncement] = useState("");

  const moveByKeyboard = useCallback(
    (key: string, columnId: string, direction: "left" | "right" | "up" | "down"): void => {
      const colIndex = visible.findIndex(c => c.id === columnId);
      const column = visible[colIndex];
      if (column === undefined) return;
      const cards = buckets.get(columnId) ?? [];
      const index = cards.findIndex(t => t.key === key);
      if (index === -1) return;

      if (direction === "left" || direction === "right") {
        const targetColumn = visible[colIndex + (direction === "left" ? -1 : 1)];
        if (targetColumn === undefined) return;
        const status = statusForColumn(targetColumn);
        if (status === undefined) return;
        // Appended to the end of the destination column, which is the
        // one position that needs no pointer to express.
        const targetCards = buckets.get(targetColumn.id) ?? [];
        const after = targetCards[targetCards.length - 1]?.key;
        runMove({ key, status, ...(after !== undefined ? { after } : {}) });
        setAnnouncement(
          `${key} moved to ${targetColumn.label}, position ${targetCards.length + 1}.`,
        );
        return;
      }

      const targetIndex = index + (direction === "up" ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= cards.length) return;
      const others = cards.filter(t => t.key !== key);
      const { after, before } = neighboursAt(others, targetIndex);
      runMove({
        key,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      setAnnouncement(
        `${key} moved to position ${targetIndex + 1} in ${column.label}.`,
      );
    },
    [visible, buckets, runMove],
  );

  // The dragged card's data, for the floating preview.
  const draggedTask = useMemo(
    () => (drag === null ? undefined : items.find(t => t.key === drag.key)),
    [drag, items],
  );

  const toggleColumn = (columnId: string): void => {
    const current = userSettings.data?.settings ?? {};
    const next = withHiddenColumns(
      current,
      hidden.includes(columnId)
        ? hidden.filter(id => id !== columnId)
        : [...hidden, columnId],
    );
    setChipError(null);
    settingsWrite.mutate(next, {
      onError: (err: unknown) => { setChipError(err); },
    });
  };

  // A config `workflow.yaml` refuses to load takes every read with it:
  // `/api/tasks` and `/api/workflow` both 400 with `config_invalid`
  // (measured). BRD-45 wants that rendered as a designed state naming
  // the file and the offending keys, not a white pane — so it is
  // checked before anything that depends on a column model, because
  // there isn't one.
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

  const loading = tasks.isLoading || workflow.isLoading;
  const queryFailed = !loading && (tasks.isError || workflow.isError);

  if (queryFailed) {
    return (
      <div className="p-4">
        <ErrorState
          error={tasks.error ?? workflow.error}
          context="Could not load the board"
          onRetry={() => {
            void tasks.refetch();
            void workflow.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="board">
      {/* BRD-41/BRD-43/BRD-44: a drop that did not land names the
          task, says plainly that it was not saved, and offers a retry
          that re-issues the same move. The card itself is already back
          in its original column — the refetch in `useBoardMove`
          settles the board to what the files say, so nothing optimistic
          survives this (P1). */}
      {moveError !== null && (
        <div
          role="alert"
          data-testid="board-move-error"
          className="flex items-center gap-3 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          <span className="min-w-0 flex-1">
            <strong>{moveError.key}</strong> was not moved — the change was not
            saved. {moveError.message}
          </span>
          <button
            type="button"
            data-testid="board-move-retry"
            onClick={() => {
              const req = lastMove.current;
              if (req !== null) runMove(req);
            }}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Retry
          </button>
          <button
            type="button"
            data-testid="board-move-reload"
            onClick={() => { window.location.reload(); }}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Reload
          </button>
        </div>
      )}

      {chipError !== null && (
        <div
          role="alert"
          data-testid="board-chip-error"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          Column visibility was not saved, so it will reset when you reload.{" "}
          {chipError instanceof ApiError ? chipError.envelope?.message ?? chipError.message : "The server could not be reached."}
        </div>
      )}

      {/* BRD-46: one corrupt task.md must not take the board down, and
          the counts must be honest about what could not be read. The
          server already returns the rows it *could* parse plus a list
          of the ones it could not. */}
      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="board-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so {unreadable.length === 1 ? "it is" : "they are"}
          {" "}missing from this board. Check the file.
          <ul className="mt-1 space-y-0.5">
            {unreadable.map(u => (
              <li key={u.id} className="font-mono text-[11px]">
                {u.path}: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* BRD-17: a configured column naming a status workflow.yaml no
          longer declares. Surfaced here, naming both, rather than as a
          console warning the user never sees (P7). */}
      <ColumnDriftBanner columns={columns} />

      <ChipsBar
        columns={columns}
        counts={buckets}
        hidden={hidden}
        onToggle={toggleColumn}
        loading={loading}
      />

      {/* BRD-40: a tracker with zero tasks gets ONE board-level empty
          state, not six per-column placeholders reading as six
          separate errors — while the columns still render, so the
          workflow shape stays visible (ONB-11). */}
      {!loading && total === 0 && (
        <div
          data-testid="board-empty"
          className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[13px] text-text-tertiary"
        >
          No tasks yet.{" "}
          {/* The create modal is `flow-task-create.md`'s ticket and is
              not built (verified: no create component exists in
              `client/`). BRD-40 requires the affordance to be here and
              offered, so it is — pointed at the list, which is where a
              task can be made today. Repoint it at the modal when that
              ticket lands. */}
          <button
            type="button"
            onClick={() => void navigate({ to: "/list" })}
            className="underline underline-offset-2 hover:text-text-primary"
          >
            + Add task
          </button>
        </div>
      )}

      {/* The board region scrolls horizontally on its own (BRD-15);
          the shell around it does not move. `min-h-0` lets the columns
          own the vertical scroll instead of growing the page. */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full items-start gap-3">
          {visible.map(column => (
            <Column
              key={column.id}
              column={column}
              tasks={buckets.get(column.id) ?? []}
              layout={cardLayout}
              lookups={lookups}
              milestones={milestones.data?.items ?? []}
              sprints={sprints.data?.items ?? []}
              loading={loading}
              today={today}
              onOpen={key => void navigate({ to: "/tasks/$key", params: { key } })}
              onFilterLabel={id =>
                void navigate({ search: prev => ({ ...prev, labels: [id] }) })
              }
              drag={drag}
              onCardPointerDown={onPointerDown}
              onKeyboardMove={moveByKeyboard}
            />
          ))}
          {/* BRD-16: one column must not stretch into a full-width
              slab. The columns are fixed-width and left-aligned, and
              this soaks up the remaining space. */}
          <div className="min-w-0 flex-1" aria-hidden="true" />
        </div>
      </div>

      {/* BRD-38: the keyboard move is announced to assistive tech,
          naming the destination column and the position. A visual drag
          shows its result; a keyboard move otherwise has nothing to
          tell a screen-reader user it happened. */}
      <div
        aria-live="polite"
        role="status"
        data-testid="board-live-region"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* The card under the cursor. Rendered outside the columns and
          pointer-transparent so `elementFromPoint` resolves the column
          beneath it rather than the card itself (BRD-32: the card
          stays under the cursor for the whole drag). */}
      {drag !== null && draggedTask !== undefined && (
        <div
          data-testid="board-drag-preview"
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
            sprints={sprints.data?.items ?? []}
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
 * Page size for a board read.
 *
 * The board renders whole columns, so it pages until the feed is
 * exhausted rather than showing the first 50. 200 is the server's
 * `limit` ceiling (`urlInt(1, 200)` in the list search schema and the
 * server's own parse), so this is one request per 200 tasks.
 */
const BOARD_PAGE_SIZE = 200;

/** Pulls a `config_invalid` envelope off a query error, if that is what it is. */
function configInvalidOf(error: unknown): ApiError | null {
  return error instanceof ApiError && error.envelope?.code === "config_invalid"
    ? error
    : null;
}

function ColumnDriftBanner({ columns }: { readonly columns: readonly BoardColumn[] }) {
  const drifted = columns.filter(c => (c.missingStatuses?.length ?? 0) > 0);
  if (drifted.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="board-column-drift"
      className="rounded-md border border-warning-fg/30 bg-warning-fg/5 px-3 py-2 text-[12px] text-warning-fg"
    >
      {drifted.map(c => (
        <div key={c.id}>
          Column <strong>{c.label}</strong> lists{" "}
          {c.missingStatuses?.length === 1 ? "a status" : "statuses"}{" "}
          <code className="font-mono">{c.missingStatuses?.join(", ")}</code>{" "}
          that <code className="font-mono">workflow.yaml</code> no longer defines.
        </div>
      ))}
    </div>
  );
}

function ChipsBar({
  columns,
  counts,
  hidden,
  onToggle,
  loading,
}: {
  readonly columns: readonly BoardColumn[];
  readonly counts: ReadonlyMap<string, readonly TaskFrontmatterPublic[]>;
  readonly hidden: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly loading: boolean;
}) {
  return (
    // BRD-15: twenty chips wrap rather than pushing the board below
    // the fold.
    <div className="flex flex-wrap gap-1.5" data-testid="board-chips">
      {columns.map(column => {
        const off = hidden.includes(column.id);
        const count = counts.get(column.id)?.length ?? 0;
        return (
          <button
            key={column.id}
            type="button"
            // The chip is a toggle, so its state is the control's
            // state — a screen reader should hear "pressed", not infer
            // it from a colour (flow-accessibility).
            aria-pressed={!off}
            data-testid={`board-chip-${column.id}`}
            onClick={() => { onToggle(column.id); }}
            title={column.disambiguator === undefined ? column.label : `${column.label} (${column.disambiguator})`}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
              off
                // BRD-3: an off chip stays in the bar, dimmed, so the
                // column can be turned back on.
                ? "border-border-subtle bg-transparent text-text-tertiary"
                : "border-border-subtle bg-bg-muted text-text-primary",
            ].join(" ")}
          >
            <span className="max-w-[18ch] truncate">{column.label}</span>
            <span className="text-text-tertiary">{loading ? "–" : count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Column({
  column,
  tasks,
  layout,
  lookups,
  milestones,
  sprints,
  loading,
  today,
  onOpen,
  onFilterLabel,
  drag,
  onCardPointerDown,
  onKeyboardMove,
}: {
  readonly column: BoardColumn;
  readonly tasks: readonly TaskFrontmatterPublic[];
  readonly layout: readonly CardLayoutField[];
  readonly lookups: ReturnType<typeof buildLookups>;
  readonly milestones: readonly { id: string; name: string }[];
  readonly sprints: readonly { id: string; name: string }[];
  readonly loading: boolean;
  readonly today: string;
  readonly onOpen: (key: string) => void;
  readonly onFilterLabel: (id: string) => void;
  readonly drag: DragState | null;
  readonly onCardPointerDown: (
    e: React.PointerEvent,
    key: string,
    columnId: string,
    originNeighbours: DropNeighbours,
  ) => void;
  readonly onKeyboardMove: (
    key: string,
    columnId: string,
    direction: "left" | "right" | "up" | "down",
  ) => void;
}) {
  const over = column.wip !== undefined && tasks.length > column.wip;
  const atCap = column.wip !== undefined && tasks.length === column.wip;

  const isDropTarget = drag !== null && drag.over?.columnId === column.id;
  // BRD-11: the source position collapses while the card is held, so
  // the board does not jump when the card is finally removed. The card
  // is hidden in place rather than spliced out of the array, which is
  // what keeps every other card's DOM node — and therefore its CSS
  // transition — alive across the drag.
  const draggingKey = drag?.key;
  // The cards the drop indicator and the geometry both see. The
  // dragged card is replaced by a placeholder of the same height
  // rather than removed: BRD-11 asks for the source position to hold
  // its space so the board does not jump, and the geometry needs it
  // too — with the card spliced out, every card below shifts up, and
  // the pointer held perfectly still then resolves to the slot BELOW
  // where the drag started. Measured: a card dropped back on its own
  // centre reported the end-of-column slot and issued a write BRD-31
  // forbids.
  // Every card stays rendered, the dragged one included. It is made
  // invisible (not removed) so it still occupies its slot: removing it
  // collapses the column, every card below shifts up, and a pointer
  // held perfectly still then resolves to the slot BELOW where the
  // drag began. Measured before this: a card dropped back on its own
  // centre reported the end-of-column slot and issued the write
  // BRD-31 forbids. Keeping the box also gives BRD-11 its
  // "source position holds its space so the board doesn't jump".
  const rest = tasks;
  const dropIndex = isDropTarget ? drag.over?.index : undefined;

  return (
    <section
      data-testid={`board-column-${column.id}`}
      // The drag resolves the column under the pointer from this
      // attribute (`elementFromPoint` → `closest`), so it must stay on
      // the element that covers the whole column, header included.
      data-column-id={column.id}
      aria-label={column.label}
      data-drop-active={isDropTarget ? "true" : undefined}
      // BRD-15/BRD-20: a fixed width keeps columns uniform whatever
      // the label length, and keeps twenty of them readable rather
      // than squashed. `shrink-0` is what makes the region scroll.
      //
      // BRD-11: the hovered column is visually distinguished from the
      // others while a card is held over it.
      className={[
        "flex h-full w-[280px] shrink-0 flex-col rounded-md border bg-bg-surface transition-colors",
        isDropTarget
          ? "border-accent-fg ring-1 ring-accent-fg/40"
          : "border-border-subtle",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          {/* BRD-20: a 60-character or emoji label truncates with the
              full text on hover, rather than wrapping to five lines
              and pushing the count off-screen. */}
          <div className="truncate text-[13px] font-semibold text-text-primary" title={column.label}>
            {column.label}
          </div>
          {/* BRD-19: two statuses may share a label. Where that
              happens the key is shown as a subtitle so the user can
              tell the two columns apart. */}
          {column.disambiguator !== undefined && (
            <div className="truncate font-mono text-[10px] text-text-tertiary">
              {column.disambiguator}
            </div>
          )}
        </div>
        <span
          data-testid={`board-count-${column.id}`}
          className={[
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums",
            over
              ? "bg-danger-fg/10 font-semibold text-danger-fg"
              : atCap
                ? "bg-warning-fg/10 font-semibold text-warning-fg"
                : "text-text-tertiary",
          ].join(" ")}
        >
          {/* BRD-6: a capped column shows both numbers; an uncapped
              one shows a plain count and never an over-cap state. */}
          {loading ? "–" : column.wip === undefined ? tasks.length : `${tasks.length} / ${column.wip}`}
        </span>
      </header>

      {column.kind === "orphan" && (
        <p className="border-b border-border-subtle px-3 py-2 text-[11px] text-text-tertiary">
          {/* BRD-18: names the orphan keys verbatim, so the user can
              find them in workflow.yaml. */}
          These tasks carry a status <code className="font-mono">workflow.yaml</code>{" "}
          no longer defines: <code className="font-mono">{column.statuses.join(", ")}</code>.
        </p>
      )}
      {column.kind === "uncovered" && (
        <p className="border-b border-border-subtle px-3 py-2 text-[11px] text-text-tertiary">
          {/* BRD-24: the uncovered statuses' tasks are shown and
              counted rather than silently omitted. */}
          Statuses not listed in any configured column:{" "}
          <code className="font-mono">{column.statuses.join(", ")}</code>.
        </p>
      )}

      {/* The column scrolls on its own (BRD-21), independently of its
          neighbours and of the horizontal board scroll. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {loading ? (
          // BRD-39: skeleton cards, so the user never sees a "0" count
          // and a "No tasks" placeholder on a column that has cards.
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : tasks.length === 0 ? (
          // BRD-7 / ONB-11: an explicit placeholder, not a blank strip.
          <p
            data-testid={`board-placeholder-${column.id}`}
            className="rounded border border-dashed border-border-subtle px-3 py-6 text-center text-[12px] text-text-tertiary"
          >
            No tasks in {column.label}
          </p>
        ) : (
          <>
            {rest.map((task, i) => (
              <Fragment key={task.id}>
                {/* BRD-11: the gap opens at the insertion point. It is
                    a real element with a height transition, so moving
                    between positions animates rather than teleports. */}
                <DropIndicator active={dropIndex === i} />
                <BoardCard
                  task={task}
                  layout={layout}
                  lookups={lookups}
                  milestones={milestones}
                  sprints={sprints}
                  today={today}
                  // BRD-11: the source position shows a placeholder
                  // rather than vanishing, so the board does not jump
                  // when the card is finally removed. The floating
                  // preview is what the user drags.
                  placeholder={task.key === draggingKey}
                  onOpen={onOpen}
                  onFilterLabel={onFilterLabel}
                  onPointerDown={e => {
                    // The neighbours this card currently sits between,
                    // computed from the list with the card itself
                    // removed — the same basis the drop uses, so the
                    // two are comparable (BRD-31).
                    onCardPointerDown(
                      e,
                      task.key,
                      column.id,
                      neighboursAt(rest.filter(t => t.key !== task.key), i),
                    );
                  }}
                  onMoveKey={dir => { onKeyboardMove(task.key, column.id, dir); }}
                />
              </Fragment>
            ))}
            <DropIndicator active={dropIndex === rest.length} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The gap that opens where a dropped card would land (BRD-11).
 *
 * Always rendered, with height animated between 0 and its open size,
 * so moving the pointer between two positions slides the gap instead
 * of removing one element and inserting another — which is what
 * "teleporting" looks like, and what the case rules out.
 */
function DropIndicator({ active }: { readonly active: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-testid="board-drop-indicator"
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
      data-testid="board-skeleton"
      className="h-16 animate-pulse rounded border border-border-subtle bg-bg-muted"
    />
  );
}
