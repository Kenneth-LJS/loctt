import type { MilestoneDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useArchiveMilestone,
  useCountedMilestones,
  useCreateMilestone,
  useDeleteMilestone,
  useUpdateMilestone,
} from "../api/hooks/useDataMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";

/**
 * Settings → Data → Milestones (MSL-11, MSL-13, MSL-14).
 *
 * This is CRUD management, not a progress surface — the
 * `/milestones` view and the milestone detail (M4.9) are where
 * progress lives. The distinction matters because both read the same
 * endpoint and it would be easy to grow a second, disagreeing
 * denominator here.
 *
 * MSL-14's date rules are the fiddly part: a cleared date must return
 * the milestone to the undated presentation, not to a `1970-01-01`
 * sentinel. `target_date` is optional in the schema, so clearing means
 * sending `null` and letting core drop the key — an empty string would
 * fail `IsoDate` validation, and `0`/epoch would be a real date.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function MilestoneRow({ milestone, count, all }: {
  readonly milestone: MilestoneDef & { readonly taskCount?: number };
  readonly count: number;
  readonly all: readonly MilestoneDef[];
}) {
  const update = useUpdateMilestone();
  const archive = useArchiveMilestone();
  const del = useDeleteMilestone();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(milestone.name);
  const [date, setDate] = useState(milestone.target_date ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archived = milestone.archived === true;
  const dateOk = date === "" || ISO_DATE_RE.test(date);
  const nameOk = name.trim().length > 0;

  return (
    <li
      data-testid={`milestone-row-${milestone.id}`}
      data-milestone-archived={archived ? "true" : "false"}
      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
    >
      {editing
        ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex gap-2">
                <input
                  aria-label="Milestone name"
                  data-testid="milestone-name-input"
                  value={name}
                  onChange={e => { setName(e.target.value); }}
                  className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
                />
                <input
                  type="date"
                  aria-label="Target date"
                  data-testid="milestone-date-input"
                  value={date}
                  onChange={e => { setDate(e.target.value); }}
                  className="w-40 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
                />
              </div>
              {!dateOk && (
                <p role="alert" className="text-[0.8571rem] text-danger-fg">
                  Target date must be an ISO date like <code className="font-mono">2026-03-31</code>.
                </p>
              )}
              {update.isError && (
                <p role="alert" className="text-[0.8571rem] text-danger-fg">
                  {update.error instanceof ApiError ? update.error.message : "Could not save."}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="milestone-save"
                  disabled={!dateOk || !nameOk || update.isPending}
                  onClick={() => {
                    update.mutate(
                      {
                        id: milestone.id,
                        name: name.trim(),
                        // MSL-14: null clears the key entirely. "" would
                        // be rejected by IsoDate, and any epoch default
                        // would be a real date the user never chose.
                        target_date: date === "" ? null : date,
                      },
                      { onSuccess: () => { setEditing(false); } },
                    );
                  }}
                  className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setName(milestone.name);
                    setDate(milestone.target_date ?? "");
                    setEditing(false);
                  }}
                  className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        : (
            <>
              <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
                {milestone.name}
                {/*
                  MSL-11 (management surface): an archived milestone is
                  still shown here and marked, not hidden, so the row
                  stays reachable to unarchive it. (MSL-25's claim — that
                  an archived milestone still resolves on tasks and by URL
                  and is revealed in the /milestones view — lives on that
                  view, not this panel.)
                */}
                {archived && (
                  <span data-testid="milestone-archived-marker" className="ml-2 text-text-tertiary">
                    (archived)
                  </span>
                )}
              </span>
              {/*
                MSL-14 / MSL-16: an undated milestone says so explicitly.
                Never blank, never a bare dash, never today.
              */}
              <span
                data-testid="milestone-date"
                data-milestone-date={milestone.target_date ?? "none"}
                className="w-40 shrink-0 text-[0.8571rem] text-text-secondary"
              >
                {milestone.target_date ?? "No target date"}
              </span>
              <span
                data-testid="milestone-refcount"
                data-milestone-refcount={String(count)}
                className="w-24 shrink-0 text-right text-[0.8571rem] text-text-secondary"
              >
                {String(count)} task{count === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                data-testid="milestone-edit"
                onClick={() => {
                  // B2 bug 5: re-seed name/date from the CURRENT props on
                  // Edit-open. Seeded once at mount, a stale draft would
                  // be written back on Save after an external rename,
                  // silently reverting it.
                  setName(milestone.name);
                  setDate(milestone.target_date ?? "");
                  update.reset();
                  setEditing(true);
                }}
                className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem]"
              >
                Edit
              </button>
              <button
                type="button"
                data-testid="milestone-archive-toggle"
                disabled={archive.isPending}
                onClick={() => { archive.reset(); archive.mutate({ id: milestone.id, archived: !archived }); }}
                className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] disabled:opacity-50"
              >
                {archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                data-testid="milestone-delete"
                onClick={() => { setConfirmingDelete(true); }}
                className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem]"
              >
                Delete
              </button>
              {/* B2 bug 3: an archive/unarchive that fails must say so —
                  the toggle used to swallow the error and read as done
                  while nothing changed on disk. */}
              {archive.isError && (
                <p
                  role="alert"
                  data-testid="milestone-archive-error"
                  className="basis-full text-[0.8571rem] text-danger-fg"
                >
                  {archive.error instanceof ApiError ? archive.error.message : "Could not change the archived state."}
                </p>
              )}
            </>
          )}

      {confirmingDelete && (
        /*
          MSL-13: a zero-reference milestone gets a simple confirm with
          no remap picker (there is nothing to remap); a referenced one
          demands the choice. The shared dialog switches on `count`, so
          the two cannot drift apart.
        */
        <RemapDeleteDialog
          noun="milestone"
          itemLabel={milestone.name}
          itemKey={milestone.name}
          count={count}
          alternatives={all
            .filter(m => m.id !== milestone.id && m.archived !== true)
            .map(m => ({ key: m.id, label: m.name }))}
          pending={del.isPending}
          error={del.isError
            ? (del.error instanceof ApiError ? del.error.message : "Delete failed.")
            : undefined}
          onClose={() => { setConfirmingDelete(false); }}
          onConfirm={(choice) => {
            del.mutate(
              {
                id: milestone.id,
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

export function MilestonesPanel() {
  const milestones = useCountedMilestones();
  const create = useCreateMilestone();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  if (milestones.isError) {
    return (
      <div className="p-8" data-testid="milestones-panel">
        <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
          Milestones
        </h1>
        <div data-testid="milestones-load-error" data-milestones-state="load-failed">
          <ErrorState
            error={milestones.error}
            onRetry={() => { void milestones.refetch(); }}
            context="reading .loctt/config/milestones.yaml"
          />
          <p className="mt-2 text-[0.9286rem] text-text-secondary">
            This is a failure to read the file, not an empty milestone list.
          </p>
        </div>
      </div>
    );
  }

  if (milestones.isLoading || milestones.data === undefined) {
    return <LoadingState>Loading milestones…</LoadingState>;
  }

  const items = milestones.data.items;

  return (
    <div className="p-8" data-testid="milestones-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Milestones
      </h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Stored in{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
          .loctt/config/milestones.yaml
        </code>. Progress is shown on the Milestones view, not here.
      </p>

      <form
        data-testid="milestone-create-form"
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), ...(date !== "" ? { target_date: date } : {}) },
            { onSuccess: () => { setName(""); setDate(""); } },
          );
        }}
      >
        <input
          aria-label="New milestone name"
          data-testid="milestone-create-name"
          value={name}
          placeholder="New milestone"
          onChange={e => { setName(e.target.value); }}
          className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
        />
        <input
          type="date"
          aria-label="New milestone target date"
          data-testid="milestone-create-date"
          value={date}
          onChange={e => { setDate(e.target.value); }}
          className="w-40 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
        />
        <button
          type="submit"
          data-testid="milestone-create-submit"
          disabled={name.trim() === "" || create.isPending}
          className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1 text-[0.9286rem] disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {create.isError && (
        <p role="alert" className="mb-3 text-[0.8571rem] text-danger-fg">
          {create.error instanceof ApiError ? create.error.message : "Could not create."}
        </p>
      )}

      {items.length === 0
        ? (
            <p data-testid="milestones-empty" data-milestones-state="empty" className="text-[0.9286rem] text-text-tertiary">
              No milestones yet.
            </p>
          )
        : (
            <ul className="m-0 list-none p-0" data-testid="milestones-list">
              {items.map(m => (
                <MilestoneRow key={m.id} milestone={m} count={m.taskCount ?? 0} all={items} />
              ))}
            </ul>
          )}
    </div>
  );
}
