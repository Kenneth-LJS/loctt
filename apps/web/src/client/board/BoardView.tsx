import type { CardLayoutField, TaskFrontmatterPublic } from "@loctt/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "../api/hooks/sidebarData.ts";
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

/**
 * The board (M3.1) — a static, read-only board.
 *
 * Drag-and-drop is M3.2 and deliberately absent: no card is draggable,
 * and nothing here writes `board_rank`. The column model, the chips
 * bar and the card renderer are built so that M3.2 adds a drag layer
 * rather than rewriting them.
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

  // BRD-48: the write can fail. The optimistic hide is rolled back by
  // the mutation, so the board and the file agree again — this is what
  // tells the user why the column came back.
  const [chipError, setChipError] = useState<unknown>(null);

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

  const visible = columns.filter(c => !hidden.includes(c.id));
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
            />
          ))}
          {/* BRD-16: one column must not stretch into a full-width
              slab. The columns are fixed-width and left-aligned, and
              this soaks up the remaining space. */}
          <div className="min-w-0 flex-1" aria-hidden="true" />
        </div>
      </div>
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
}) {
  const over = column.wip !== undefined && tasks.length > column.wip;
  const atCap = column.wip !== undefined && tasks.length === column.wip;

  return (
    <section
      data-testid={`board-column-${column.id}`}
      aria-label={column.label}
      // BRD-15/BRD-20: a fixed width keeps columns uniform whatever
      // the label length, and keeps twenty of them readable rather
      // than squashed. `shrink-0` is what makes the region scroll.
      className="flex h-full w-[280px] shrink-0 flex-col rounded-md border border-border-subtle bg-bg-surface"
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
          tasks.map(task => (
            <BoardCard
              key={task.id}
              task={task}
              layout={layout}
              lookups={lookups}
              milestones={milestones}
              sprints={sprints}
              today={today}
              onOpen={onOpen}
              onFilterLabel={onFilterLabel}
            />
          ))
        )}
      </div>
    </section>
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
