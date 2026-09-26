import type { CardLayoutField } from "@loctt/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, isUnknownOutcome } from "../api/client.ts";
import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "../api/hooks/sidebarData.ts";
import { useBoardMove } from "../api/hooks/useBoardMove.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import type { TaskListRow } from "../api/hooks/useTasks.ts";
import { tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { useCreateTask } from "../create/CreateTaskProvider.tsx";
import { FilterBar } from "../list/FilterBar.tsx";
import { buildLookups } from "../list/lookups.ts";
import { useScopeTitle } from "../list/useScopeTitle.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import { BoardCard } from "./BoardCard.tsx";
import { resolveCardLayout, resolveColumnCardLayout } from "./cardLayout.ts";
import { hiddenColumnsOf, withHiddenColumns } from "./chipSettings.ts";
import type { BoardColumn } from "./columns.ts";
import { bucketTasks, deriveColumns } from "./columns.ts";
import { ConfigErrorState } from "./ConfigErrorState.tsx";
import type { DropNeighbours } from "./dragModel.ts";
import { neighboursAt, statusForColumn } from "./dragModel.ts";
import type { BoardCardBadges } from "./relationshipBadges.ts";
import { boardCardBadges } from "./relationshipBadges.ts";
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
  // K-title rule: scope-aware title (view/project name, else "Board").
  const title = useScopeTitle(search, "Board");
  const navigate = useNavigate({ from: "/board" });
  const createTask = useCreateTask();

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
  // A313: parity with the list and timeline (ListView.tsx, TimelineView.tsx).
  // `?view=<broken id>` returns a non-fatal `broken_view` diagnostic
  // alongside every task, unfiltered — the board previously drew a card
  // for every task in the tracker under no explanation at all (UI-24).
  // Suppressing `items` here means `columns`/`buckets` below inherit the
  // empty state rather than needing their own guard.
  const brokenView = pages[pages.length - 1]?.broken_view;
  const items = useMemo(
    () => (brokenView !== undefined ? [] : pages.flatMap(p => p.items)),
    [pages, brokenView],
  );
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

  // BRD-50 (UX-5): blocked / epic-child-count / subtask markers, derived
  // from each card's own relationships against the workflow config. The
  // config is read once here (not per card), so the badge-key resolution
  // does not run for every card on every render.
  const badgesFor = useMemo(() => {
    const wf = workflow.data;
    return (task: TaskListRow): BoardCardBadges => boardCardBadges(task, wf);
  }, [workflow.data]);

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
  // `unknown`: the move timed out and may have landed, so the banner
  // must not say it wasn't saved (A348).
  const [moveError, setMoveError] = useState<
    { key: string; message: string; unknown: boolean } | null
  >(null);
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
            unknown: isUnknownOutcome(err),
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

  const loading = tasks.isLoading || workflow.isLoading;

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

  // BRD-39 / ERR-5: the skeleton is not an infinite state. Formerly this
  // needed a second, bespoke `useStalledLoad` timer because a hung
  // `/api/tasks` never set `isError` — nothing had failed, it just never
  // answered — so this check alone never fired. K115 (A314) gives
  // `apiRequest` its own default deadline (20s on a GET), so a hung read
  // now genuinely fails with a timeout `ApiError` and reaches `isError`
  // on its own; the separate stall timer was retired as redundant rather
  // than kept as a second mechanism for the same symptom.
  const queryFailed = !loading && (tasks.isError || workflow.isError);

  if (queryFailed) {
    return (
      <ErrorState
        error={tasks.error ?? workflow.error}
        context="Loading the board's tasks"
        onRetry={() => {
          void tasks.refetch();
          void workflow.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="board">
      {/* K-title rule: the page title anchors the screen ABOVE the toolbar
          (was below it — Ken's bug). The chips bar is its own row below the
          filter bar. Title text is the active scope (view/project) or
          "Board".

          UI-3: the actions slot used to hold "+ Add task" AND a second
          "⋯" (K100's `BoardOptionsMenu`), a few pixels from the filter
          bar's own "⋯" and at a different size — two identical-looking
          overflow buttons whose contents nobody could predict. The
          board options are now a "Configure" section inside the ONE ⋯
          the bar owns (see `extraMenuSections` below).

          UI-13: the board's own "+ Add task" that used to live here is
          gone. It called the identical `createTask.open()` the header's
          "+ New task" already calls — same modal, same fields — and
          PRU-4 (`CreateTaskModal.tsx:110-130`) already pre-fills the
          route-scoped project for either entry point, so the board copy
          added nothing but a second, differently-worded button ~200px
          from the header's. The board's only remaining create
          affordance is the board-level empty state below (BRD-40),
          which is not this duplicate — see its own comment. */}
      <PageHeader
        title={title}
        testId="board-header"
      />

      {/* The shared filter bar (cross-view scope fix, Ken 2026-09-20):
          the board reads the same URL filter vocabulary as the list
          (BRD-1/BRD-14), so it mounts the same bar the list does. Refresh
          re-runs the board's own feed; export is omitted (the board has no
          export surface). Save-as-view is offered — a board scope is a
          saved view like any other. */}
      <FilterBar
        from="/board"
        showSaveView
        // UI-3: the two board config deep links, merged out of the
        // deleted second ⋯ into this bar's menu as a "Configure"
        // section. K100 still holds: board config is discoverable from
        // the board, and both are whole-surface editors (columns =
        // whole-document draft, card layout = whole-surface pref), so
        // both stay DEEP LINKS labelled as navigation — never in-place
        // edits from a view. Only which ⋯ they live in changed.
        extraMenuSections={<BoardConfigLinks />}
      />

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
          className="flex items-center gap-3 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          <span className="min-w-0 flex-1">
            {moveError.unknown ? (
              <>
                <strong>{moveError.key}</strong> may not have been moved.
                Please check and try again.
              </>
            ) : (
              <>
                <strong>{moveError.key}</strong> wasn't moved. The change wasn't
                saved. {moveError.message}
              </>
            )}
          </span>
          <Button
            variant="danger-outline"
            size="sm"
            testId="board-move-retry"
            onClick={() => {
              const req = lastMove.current;
              if (req !== null) runMove(req);
            }}
            className="shrink-0"
          >
            Retry
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            testId="board-move-reload"
            onClick={() => { window.location.reload(); }}
            className="shrink-0"
          >
            Reload
          </Button>
        </div>
      )}

      {chipError !== null && (
        <div
          role="alert"
          data-testid="board-chip-error"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          Column visibility wasn't saved. It will reset when you reload.{" "}
          {chipError instanceof ApiError ? chipError.envelope?.message ?? chipError.message : "The server could not be reached."}
        </div>
      )}

      {/* A313 (UI-24): parity with the list's and timeline's `broken_view`
          banner (ListView.tsx, TimelineView.tsx) — the saved view's query
          no longer parses. Unfiltered cards are not drawn (see `items`
          above); this is what explains why every column is empty instead
          of leaving that unstated. */}
      {brokenView !== undefined && (
        <div
          role="alert"
          data-testid="board-broken-view"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          <p className="font-medium">
            The saved view <code>{brokenView.name}</code> could
            not be run: its query no longer parses.
          </p>
          <p data-testid="board-broken-view-error" className="mt-1">
            {brokenView.error}
            {brokenView.position !== undefined
              ? <> (at position <span data-testid="board-broken-view-position">{brokenView.position}</span>)</>
              : null}
          </p>
          <Link
            to="/settings/$section"
            params={{ section: "saved-views" }}
            hash={`row-${brokenView.id}`}
            data-testid="board-broken-view-manage"
            className="mt-1 inline-block underline hover:text-text-primary"
          >
            Fix it in the file, or replace it in Saved views
          </Link>
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
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read. Missing from this board.
          <ul className="mt-1 space-y-0.5">
            {unreadable.map(u => (
              <li key={u.id} className="text-[0.7857rem]">
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
          workflow shape stays visible (ONB-11).
          A313: gated on `brokenView === undefined` too — the banner
          above already explains an empty board under a broken view;
          "No tasks yet" alongside it would be a second, confusing
          message for the same cause (the same reasoning `TimelineView`
          uses for its own `noRows` branch). */}
      {!loading && brokenView === undefined && total === 0 && (
        <div
          data-testid="board-empty"
          className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[0.9286rem] text-text-tertiary"
        >
          No tasks found.{" "}
          {/* BRD-40's affordance, pointed at the create modal (M3.4)
              rather than at `/list`.

              It is deliberately the *only* create affordance on this
              view (UI-13 removed the header-duplicate "+ Add task" that
              used to sit in the PageHeader actions slot — see that
              comment). This one is not a duplicate: on an empty board
              there is nothing else to click, so it earns its keep.
              BRD-40 asks for "one board-level empty state ... [that]
              offers '+ Add task'" and says nothing about per-column
              controls; adding one per column would put a control on
              every stale column too, and BRD-42 turns on a column that
              is still rendered for a status `workflow.yaml` no longer
              defines. A per-column control that resolves anything from
              workflow config would throw or render nothing for exactly
              that column — which is the one BRD-42 drags into.

              UI-13: relabelled "+ Add task" → "+ New task" — "New" is
              the house term ("+ New project", "+ New view", "+ New
              milestone"); "Add" was the outlier. The testId and
              behaviour are unchanged, only the wording. */}
          <button
            type="button"
            onClick={() => { createTask.open(); }}
            className="underline underline-offset-2 hover:text-text-primary"
          >
            + New task
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
              badgesFor={badgesFor}
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
              onHide={toggleColumn}
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
            badges={badgesFor(draggedTask)}
            health={draggedTask.health}
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
      className="rounded-md border border-warn-fg/30 bg-warn-fg/5 px-3 py-2 text-[0.8571rem] text-warn-fg"
    >
      {drifted.map(c => (
        <div key={c.id}>
          Column <strong>{c.label}</strong> lists{" "}
          {c.missingStatuses?.length === 1 ? "a status" : "statuses"}{" "}
          <code>{c.missingStatuses?.join(", ")}</code>{" "}
          <code>workflow.yaml</code> no longer defines.
        </div>
      ))}
      {/* K100: the banner names the fault; it must also lead to the fix.
          "Board columns" deep-links to the panel that owns the write
          (whole-document editor → link, not in-place). */}
      <div className="mt-1">
        <Link
          to="/settings/$section"
          params={{ section: "board-columns" }}
          data-testid="board-column-drift-link"
          className="font-medium text-warn-fg underline underline-offset-2 hover:no-underline"
        >
          Board columns
        </Link>
        {" "}in Settings →
      </div>
    </div>
  );
}

/**
 * Shared styling for a `<Link>` that sits inside a `Menu` panel and
 * reads as a menu row (the Header's user menu does the same). Carries
 * `role="menuitem"` so the menu's roving arrow-key focus (which queries
 * that role) includes the deep links, not only the buttons.
 */
const MENU_LINK_CLASS =
  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary";

/**
 * The per-column header menu (BRD-52, K100).
 *
 * One in-place action and two deep links, exactly as K100 assigns:
 *
 *  - **Hide column** — in-place. Column visibility is a per-user view
 *    pref (`board_hidden_columns`), the same write the chips bar makes,
 *    so it belongs at the point of use and is not a config edit.
 *  - **Set WIP limit** / **Edit board columns** — deep links to
 *    `/settings/board-columns`. Board columns are edited as a whole
 *    document (`BoardColumnsPanel` holds a draft of every column), so by
 *    K100 the point-of-use affordance is a link, labelled as navigation,
 *    not a forked in-place editor. The WIP item adds a `#column-<id>`
 *    hash so it can land on the row once the panel wires row anchors
 *    (a separate agent adds `id="column-<key>"`); until then it lands on
 *    the section, which is harmless.
 */
function ColumnHeaderMenu({
  column,
  onHide,
}: {
  readonly column: BoardColumn;
  readonly onHide: (id: string) => void;
}) {
  const name =
    column.disambiguator === undefined
      ? column.label
      : `${column.label} (${column.disambiguator})`;
  return (
    <Menu
      aria-label={`${column.label} column options`}
      align="end"
      trigger={({ toggle, ...aria }) => (
        <IconButton
          {...aria}
          size="sm"
          aria-label={`${name} column options`}
          data-testid={`board-column-menu-${column.id}`}
          onClick={toggle}
        >
          {/* UI-3: a VERTICAL kebab. The horizontal ⋯ means "this whole
              surface" (the view-options menu); this one means "this one
              item" — the column it sits on. They used to be the same
              glyph, so two different scopes read as the same button. */}
          <Icon name="moreVertical" size={16} />
        </IconButton>
      )}
    >
      {({ close }) => (
        <>
          <MenuItem
            testId={`board-column-hide-${column.id}`}
            onSelect={() => {
              onHide(column.id);
              close();
            }}
          >
            <Icon name="eyeOff" size={14} />
            Hide column
          </MenuItem>
          <Link
            to="/settings/$section"
            params={{ section: "board-columns" }}
            hash={`column-${column.id}`}
            role="menuitem"
            onClick={close}
            data-testid={`board-column-wip-${column.id}`}
            className={MENU_LINK_CLASS}
          >
            <Icon name="settings" size={14} />
            Set WIP limit
          </Link>
          <Link
            to="/settings/$section"
            params={{ section: "board-columns" }}
            role="menuitem"
            onClick={close}
            data-testid={`board-column-edit-${column.id}`}
            className={MENU_LINK_CLASS}
          >
            <Icon name="settings" size={14} />
            Edit board columns
          </Link>
        </>
      )}
    </Menu>
  );
}

/**
 * The board's two config deep links (K100), as rows for the filter
 * bar's ⋯ "Configure" section.
 *
 * Deep links to the two whole-surface config editors that shape the
 * board — the columns and the card layout — so board config is
 * reachable from the board, not only from Settings. Both are links
 * (whole-document / whole-surface writes), labelled as navigation.
 *
 * UI-3: this was `BoardOptionsMenu`, a whole second ⋯ `Menu` in the
 * PageHeader actions slot, sitting a few pixels from the filter bar's
 * ⋯ at a different size. The rows are unchanged — same labels, same
 * hrefs, same `role="menuitem"` + `MENU_LINK_CLASS` so the host menu's
 * roving arrow-key focus still finds them, same testIds — only their
 * host moved. They no longer take a `close` callback: every one of
 * them navigates, which unmounts the menu with the view.
 */
function BoardConfigLinks() {
  return (
    <>
      <Link
        to="/settings/$section"
        params={{ section: "board-columns" }}
        role="menuitem"
        data-testid="board-options-columns"
        className={MENU_LINK_CLASS}
      >
        <Icon name="settings" size={14} />
        Customize columns
      </Link>
      <Link
        to="/settings/$section"
        params={{ section: "card-layout" }}
        role="menuitem"
        data-testid="board-options-card-layout"
        className={MENU_LINK_CLASS}
      >
        <Icon name="settings" size={14} />
        Card layout
      </Link>
    </>
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
  readonly counts: ReadonlyMap<string, readonly TaskListRow[]>;
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
        // BRD-51 (UX-6): the pill must READ as a visibility toggle, so a
        // dimmed pill beside a missing column is not misread as "no
        // tasks". An eye affordance carries the state visually (open eye
        // = shown, slashed eye = hidden), the `title`/`aria-label` name
        // the action in words ("Hide column" / "Show column"), and the
        // disambiguator (BRD-19) is folded into the same label rather
        // than replaced by it.
        const action = off ? "Show" : "Hide";
        const name =
          column.disambiguator === undefined
            ? column.label
            : `${column.label} (${column.disambiguator})`;
        const label = `${action} column ${name}`;
        return (
          <button
            key={column.id}
            type="button"
            // The chip is a toggle, so its state is the control's
            // state — a screen reader should hear "pressed", not infer
            // it from a colour (flow-accessibility).
            aria-pressed={!off}
            aria-label={label}
            data-testid={`board-chip-${column.id}`}
            onClick={() => { onToggle(column.id); }}
            title={label}
            className={[
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8571rem]",
              off
                // BRD-3: an off chip stays in the bar, dimmed, so the
                // column can be turned back on.
                ? "border-border-subtle bg-transparent text-text-tertiary"
                : "border-border-subtle bg-bg-muted text-text-primary",
            ].join(" ")}
          >
            {/* BRD-51: the eye is the discoverability affordance — it
                makes "this is a show/hide toggle" legible at a glance,
                not only in the tooltip. Decorative (the action is in the
                accessible name), so hidden from assistive tech. */}
            <span className="shrink-0 text-text-tertiary">
              <Icon name={off ? "eyeOff" : "eye"} size={14} />
            </span>
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
  badgesFor,
  milestones,
  sprints,
  loading,
  today,
  onOpen,
  onFilterLabel,
  drag,
  onCardPointerDown,
  onKeyboardMove,
  onHide,
}: {
  readonly column: BoardColumn;
  readonly tasks: readonly TaskListRow[];
  readonly layout: readonly CardLayoutField[];
  readonly lookups: ReturnType<typeof buildLookups>;
  readonly badgesFor: (task: TaskListRow) => BoardCardBadges;
  readonly milestones: readonly { id: string; name: string }[];
  readonly sprints: readonly { id: string; name: string }[];
  readonly loading: boolean;
  readonly today: string;
  readonly onOpen: (key: string) => void;
  readonly onFilterLabel: (id: string) => void;
  // BRD-52 (K100): the per-user Hide action, the same write the chips
  // bar makes — this stays in-place because column visibility is a
  // per-user view pref, not workflow.yaml config.
  readonly onHide: (id: string) => void;
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
  // K9: a card's status is always visible where the column collapses
  // more than one, whatever `card_layout` says. Resolved per column
  // rather than per board, because a board can hold both kinds.
  const columnLayout = resolveColumnCardLayout(layout, column.statuses);
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
      // S-11 (UX-16 / 6.6): the width is `w-[280px]` on tablet and up,
      // but on a phone-width viewport a fixed 280px column can be wider
      // than the pane, crushing the layout and hiding that the board
      // scrolls. It degrades to `min(85vw, 280px)`: a column never
      // exceeds 280px, but on a narrow screen it caps at 85vw so the
      // next column peeks in at the edge — the affordance that tells the
      // user the board scrolls horizontally. `shrink-0` keeps every
      // column its own size so the region (not the columns) scrolls.
      //
      // BRD-11: the hovered column is visually distinguished from the
      // others while a card is held over it.
      className={[
        "flex h-full w-[min(85vw,280px)] shrink-0 flex-col rounded-md border bg-bg-surface transition-colors sm:w-[280px]",
        isDropTarget
          ? "border-accent ring-1 ring-accent/40"
          : "border-border-subtle",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          {/* BRD-20: a 60-character or emoji label truncates with the
              full text on hover, rather than wrapping to five lines
              and pushing the count off-screen. */}
          <div className="truncate text-[0.9286rem] font-semibold text-text-primary" title={column.label}>
            {column.label}
          </div>
          {/* BRD-19: two statuses may share a label. Where that
              happens the key is shown as a subtitle so the user can
              tell the two columns apart. */}
          {column.disambiguator !== undefined && (
            <div className="truncate text-[0.7143rem] text-text-tertiary">
              {column.disambiguator}
            </div>
          )}
        </div>
        {/* A11Y-30's second bullet: an over-cap column must be
            identifiable without colour — "a count like 6 / 4 **and** a
            warning glyph with an accessible name", not by a red header
            alone. The count alone does not carry it: over-cap and
            at-cap differ only in `text-danger-fg` vs `text-warn-fg`,
            which is the colour-only signal the case forbids, and
            `data-wip-state` is invisible to a greyscale screenshot and
            to a screen reader alike.

            A **sibling** of the count, not a child of it: BRD-6
            asserts the count's exact text ("4 / 3"), and nesting the
            glyph inside made that read "⚠4 / 3". The count element
            holds the numbers and nothing else.

            Not `aria-hidden`: this is the accessible carrier, so it
            needs a name of its own rather than sitting decoratively
            beside text that never says "over". */}
        {/* The right cluster: the WIP glyph, the count, and the config
            menu, kept together at the trailing edge so adding the menu
            does not spread the three apart under `justify-between`. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {over && (
            <span
              role="img"
              aria-label={`Over WIP limit: ${String(tasks.length)} of ${String(column.wip ?? 0)}`}
              data-testid={`board-wip-warning-${column.id}`}
              className="shrink-0 text-[0.7857rem] text-danger-fg"
            >
              ⚠
            </span>
          )}
          <span
            data-testid={`board-count-${column.id}`}
            className={[
              "shrink-0 rounded px-1.5 py-0.5 text-[0.7857rem] tabular-nums",
              over
                ? "bg-danger-fg/10 font-semibold text-danger-fg"
                : atCap
                  ? "bg-warn-fg/10 font-semibold text-warn-fg"
                  : "text-text-tertiary",
            ].join(" ")}
            data-wip-state={over ? "over" : atCap ? "at-cap" : "under"}
          >
            {/* BRD-6: a capped column shows both numbers; an uncapped
                one shows a plain count and never an over-cap state. */}
            {loading ? "–" : column.wip === undefined ? tasks.length : `${tasks.length} / ${column.wip}`}
          </span>
          {/* BRD-52 (K100): point-of-use config for the column, from the
              header where the column is. Hide is the per-user view pref
              (in-place, same write as the chips); WIP + edit are DEEP
              LINKS to Settings because board columns are a whole-document
              editor the panel owns (K100 → link, not in-place). */}
          <ColumnHeaderMenu column={column} onHide={onHide} />
        </div>
      </header>

      {column.kind === "orphan" && (
        <p className="border-b border-border-subtle px-3 py-2 text-[0.7857rem] text-text-tertiary">
          {/* BRD-18: names the orphan keys verbatim, so the user can
              find them in workflow.yaml. */}
          These tasks carry a status <code>workflow.yaml</code>{" "}
          no longer defines: <code>{column.statuses.join(", ")}</code>.
        </p>
      )}
      {column.kind === "uncovered" && (
        <p className="border-b border-border-subtle px-3 py-2 text-[0.7857rem] text-text-tertiary">
          {/* BRD-24: the uncovered statuses' tasks are shown and
              counted rather than silently omitted. */}
          Statuses not listed in any configured column:{" "}
          <code>{column.statuses.join(", ")}</code>.
        </p>
      )}

      {/* The column scrolls on its own (BRD-21), independently of its
          neighbours and of the horizontal board scroll.

          UI-8: spacing lives on the CARD (`mb-2`), not on this container
          (`space-y-*`). The list's flow siblings are not only cards —
          `DropIndicator` sits between every pair, always rendered
          (`h-0` at rest) so the drop gap can animate rather than
          teleport. `space-y-*` gives a margin to every flow sibling
          including a hidden zero-height one, which doubled the
          card-to-card gap (7px card + 7px indicator = 14px) even
          though the indicator was invisible. `mb-2` on each card is
          unaffected by a sibling's own (zero) height. */}
      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto p-2">
        {loading ? (
          // BRD-39: skeleton cards, so the user never sees a "0" count
          // and a "No tasks" placeholder on a column that has cards.
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard className="mb-0" />
          </>
        ) : tasks.length === 0 ? (
          // BRD-7 / ONB-11: an explicit placeholder, not a blank strip.
          <p
            data-testid={`board-placeholder-${column.id}`}
            className="rounded border border-dashed border-border-subtle px-3 py-6 text-center text-[0.8571rem] text-text-tertiary"
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
                {/* UI-8: the 7px gap lives here (`mb-2`), on the card's
                    own wrapper, not on the list container. `BoardCard`
                    takes no `className`, so the margin is applied to a
                    plain wrapper div rather than threading a prop into
                    a component whose file is outside this change. */}
                <div className="mb-2">
                  <BoardCard
                    task={task}
                    badges={badgesFor(task)}
                    health={task.health}
                    layout={columnLayout}
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
                </div>
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
        active ? "my-1 h-10 border-2 border-dashed border-accent bg-accent/10" : "h-0",
      ].join(" ")}
    />
  );
}

function SkeletonCard({ className = "mb-2" }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="board-skeleton"
      className={`h-16 animate-pulse rounded border border-border-subtle bg-bg-muted ${className}`}
    />
  );
}
