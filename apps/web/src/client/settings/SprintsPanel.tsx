import type { SprintDef } from "@loctt/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useArchiveSprint, useCountedSprints, useCreateSprint, useDeleteSprint } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";

/**
 * Settings → Data → Sprints (SPR-40).
 *
 * Full management: **create**, **delete** (with remap of referencing
 * tasks), the burndown link, and the archived split. The panel was
 * read-and-navigate before; SPR-40 brings it to CLI parity for the
 * lifecycle operations the CLI already had.
 *
 * The sprint detail route (M4.7) still owns *metadata* editing (name,
 * dates, goal, state) behind its own Edit control (SPR-8) — this panel
 * does not duplicate that, only the list-level lifecycle.
 *
 * The detail route's `$key` segment is filled with the sprint's ULID:
 * `SprintDef` has no user-facing key, which is why V3 settled the
 * segment as `/sprints/<ulid>`.
 */

const STATE_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  future: "Future",
};

const STATES = ["active", "completed", "future"] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A sprint the list returns, with its reference count from `?counts=true`. */
type CountedSprint = SprintDef & { readonly taskCount?: number };

function SprintRow({ sprint, all }: {
  readonly sprint: CountedSprint;
  readonly all: readonly CountedSprint[];
}) {
  const del = useDeleteSprint();
  const archive = useArchiveSprint();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const count = sprint.taskCount ?? 0;
  const archived = sprint.archived === true;

  return (
    <li
      data-testid={`sprint-row-${sprint.id}`}
      data-sprint-state={sprint.state}
      data-sprint-archived={archived ? "true" : "false"}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-0"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
        {sprint.name}
        {archived && (
          <span data-testid="sprint-archived-marker" className="ml-2 text-text-tertiary">
            (archived)
          </span>
        )}
      </span>
      <span className="shrink-0 text-[0.8571rem] text-text-secondary">
        {STATE_LABEL[sprint.state] ?? sprint.state}
      </span>
      <span className="shrink-0 whitespace-nowrap text-[0.8571rem] text-text-secondary">
        {sprint.start_date} → {sprint.end_date}
      </span>
      <span
        data-testid="sprint-refcount"
        data-sprint-refcount={String(count)}
        className="shrink-0 whitespace-nowrap text-right text-[0.8571rem] text-text-secondary"
      >
        {String(count)} task{count === 1 ? "" : "s"}
      </span>

      {/* Row lifecycle actions collapse into a kebab so they never
          overflow the row on a narrow pane (responsive GROUP A). Burndown
          (navigation), Archive/Unarchive, and Delete. Metadata editing
          (name/dates/goal/state) still lives on the detail route (SPR-8). */}
      <div className="shrink-0">
        <RowActions
          label={`Actions for sprint ${sprint.name}`}
          actions={[
            { label: "Open burndown", testId: "sprint-burndown-link", onSelect: () => { void navigate({ to: "/sprints/$key", params: { key: sprint.id } }); } },
            {
              label: archived ? "Unarchive" : "Archive",
              testId: "sprint-archive-toggle",
              disabled: archive.isPending,
              onSelect: () => { archive.mutate({ id: sprint.id, archived: !archived }); },
            },
            { label: "Delete", testId: "sprint-delete", danger: true, onSelect: () => { setConfirmingDelete(true); } },
          ]}
        />
      </div>

      {confirmingDelete && (
        // SPR-40 / parity with `sprint delete`: a referenced sprint
        // offers a remap target (the tasks' `sprint` field is rewritten);
        // an unreferenced one is a plain confirm. Same shared dialog as
        // labels and milestones, so the two cannot drift.
        <RemapDeleteDialog
          noun="sprint"
          itemLabel={sprint.name}
          itemKey={sprint.name}
          count={count}
          alternatives={all
            .filter(s => s.id !== sprint.id && s.archived !== true)
            .map(s => ({ key: s.id, label: s.name }))}
          pending={del.isPending}
          error={del.isError
            ? (del.error instanceof ApiError ? del.error.message : "Delete failed.")
            : undefined}
          onClose={() => { setConfirmingDelete(false); }}
          onConfirm={(choice) => {
            del.mutate(
              {
                id: sprint.id,
                ...(choice.kind === "remap" ? { remapTo: choice.to } : {}),
              },
              { onSuccess: () => { setConfirmingDelete(false); } },
            );
          }}
        />
      )}
    </li>
  );
}

export function SprintsPanel() {
  const sprints = useCountedSprints();
  const create = useCreateSprint();

  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [state, setState] = useState<(typeof STATES)[number]>("active");
  const [showArchived, setShowArchived] = useState(false);

  if (sprints.isError) {
    return (
      <div className="p-8" data-testid="sprints-panel">
        <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
          Sprints
        </h1>
        <div data-testid="sprints-load-error" data-sprints-state="load-failed">
          <ErrorState
            error={sprints.error}
            onRetry={() => { void sprints.refetch(); }}
            context="reading .loctt/config/sprints.yaml"
          />
          <p className="mt-2 text-[0.9286rem] text-text-secondary">
            This is a failure to read the file, not an empty sprint list.
          </p>
        </div>
      </div>
    );
  }

  if (sprints.isLoading || sprints.data === undefined) {
    return <LoadingState>Loading sprints…</LoadingState>;
  }

  const items = sprints.data.items as readonly CountedSprint[];
  const activeItems = items.filter(s => s.archived !== true);
  const archivedItems = items.filter(s => s.archived === true);

  const datesOk = ISO_DATE_RE.test(start) && ISO_DATE_RE.test(end);
  const canCreate = name.trim().length > 0 && datesOk && !create.isPending;

  return (
    <div className="p-8" data-testid="sprints-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Sprints
      </h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Open a sprint to edit its dates, goal and state, and see its burndown.
      </p>

      {/* SPR-40: create a sprint. `state` offers exactly the three SPR-7
          states; core rejects an end before start, attributed to `end`. */}
      <form
        data-testid="sprint-create-form"
        className="mb-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canCreate) return;
          create.mutate(
            { name: name.trim(), start_date: start, end_date: end, state },
            { onSuccess: () => { setName(""); setStart(""); setEnd(""); setState("active"); } },
          );
        }}
      >
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
          Name
          <TextField
            data-testid="sprint-create-name"
            size="sm"
            value={name}
            placeholder="New sprint"
            onChange={e => { setName(e.target.value); }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
          Start
          <TextField
            data-testid="sprint-create-start"
            type="date"
            size="sm"
            value={start}
            onChange={e => { setStart(e.target.value); }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
          End
          <TextField
            data-testid="sprint-create-end"
            type="date"
            size="sm"
            value={end}
            onChange={e => { setEnd(e.target.value); }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
          State
          <Select
            data-testid="sprint-create-state"
            size="sm"
            value={state}
            onChange={e => { setState(e.target.value as (typeof STATES)[number]); }}
          >
            {STATES.map(s => (
              <option key={s} value={s}>{STATE_LABEL[s]}</option>
            ))}
          </Select>
        </label>
        <Button variant="primary" size="sm" type="submit" testId="sprint-create-submit" disabled={!canCreate}>
          Create
        </Button>
      </form>

      {create.isError && (
        <Callout tone="danger" role="alert" testId="sprint-create-error" className="mb-3">
          <span>
            {create.error instanceof ApiError ? create.error.message : "Could not create the sprint."}
          </span>
        </Callout>
      )}

      {activeItems.length === 0
        ? (
            <p data-testid="sprints-empty" data-sprints-state="empty" className="text-[0.9286rem] text-text-tertiary">
              No sprints yet.
            </p>
          )
        : (
            <ul className="m-0 list-none p-0" data-testid="sprints-list">
              {activeItems.map(s => <SprintRow key={s.id} sprint={s} all={items} />)}
            </ul>
          )}

      {archivedItems.length > 0 && (
        <div className="mt-5">
          <label className="flex items-center gap-2 text-[0.8571rem] text-text-secondary">
            <input
              type="checkbox"
              data-testid="sprints-show-archived"
              checked={showArchived}
              onChange={e => { setShowArchived(e.target.checked); }}
            />
            Show archived ({archivedItems.length})
          </label>
          {showArchived && (
            <ul className="m-0 mt-2 list-none p-0" data-testid="sprints-archived-list">
              {archivedItems.map(s => <SprintRow key={s.id} sprint={s} all={items} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
