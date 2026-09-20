import type { BrokenEntry, MilestoneDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useArchiveMilestone,
  useCountedMilestones,
  useCreateMilestone,
  useDeleteMilestone,
} from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { TextField } from "../ui/TextField.tsx";
import { MilestoneEditDialog } from "./MilestoneEditDialog.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";

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

function MilestoneRow({ milestone, count, all }: {
  readonly milestone: MilestoneDef & { readonly taskCount?: number };
  readonly count: number;
  readonly all: readonly MilestoneDef[];
}) {
  const archive = useArchiveMilestone();
  const del = useDeleteMilestone();
  // K100: editing now runs through the shared MilestoneEditDialog (which
  // the sidebar and the /milestones view also open), rather than an inline
  // row form. The dialog re-seeds from the current milestone on every
  // open, so the B2 bug-5 stale-draft trap is handled by mounting it fresh
  // (`editing && <MilestoneEditDialog … />`) — not by resetting state here.
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archived = milestone.archived === true;

  return (
    <li
      // K100 deep-link anchor (`/settings/milestones#row-<id>`) — see
      // useScrollToHash. Kept alongside the test id.
      id={`row-${milestone.id}`}
      data-testid={`milestone-row-${milestone.id}`}
      data-milestone-archived={archived ? "true" : "false"}
      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
    >
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
      <RowActions
        label={`Actions for milestone ${milestone.name}`}
        actions={[
          {
            label: "Edit…",
            testId: "milestone-edit",
            onSelect: () => { setEditing(true); },
          },
          {
            label: archived ? "Unarchive" : "Archive",
            testId: "milestone-archive-toggle",
            disabled: archive.isPending,
            onSelect: () => { archive.reset(); archive.mutate({ id: milestone.id, archived: !archived }); },
          },
          { label: "Delete", testId: "milestone-delete", danger: true, onSelect: () => { setConfirmingDelete(true); } },
        ]}
      />
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

      {editing && (
        <MilestoneEditDialog
          existing={milestone}
          onClose={() => { setEditing(false); }}
        />
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

/**
 * DEG-30 / A138 parity: a milestone whose stored fields do not validate
 * (a non-string `name`, an unknown key) is lifted by the tolerant loader
 * into `broken` and rides the list endpoint (`handleListMilestones`)
 * rather than being dropped. It renders here as a disabled, marked error
 * row — "⚠ <id> — couldn't be read (<reason>)" — mirroring
 * `BrokenLabelRow`, so a corrupt milestone is visible and repairable
 * instead of silently vanishing from the list (corruption-guide § 4.6).
 *
 * The affordance is **Repair** (reload-from-disk), not Delete, for the
 * same reason as labels (A202): LocTT never rewrites a corrupt config
 * entry for you, and a broken entry may not carry a readable `id` for a
 * delete to target.
 */
function BrokenMilestoneRow({ entry, onRepair, repairing }: {
  readonly entry: BrokenEntry;
  readonly onRepair: () => void;
  readonly repairing: boolean;
}) {
  const name = entry.id ?? `Milestone entry #${String(entry.index + 1)}`;
  const idOrIndex = entry.id ?? `index-${String(entry.index)}`;
  return (
    <li
      // K100 anchor: a deep link resolves by the same `row-<id>` id when
      // the loader could read one.
      {...(entry.id !== undefined ? { id: `row-${entry.id}` } : {})}
      data-testid={`milestone-broken-${idOrIndex}`}
      data-broken-milestone={idOrIndex}
      aria-disabled="true"
      className="flex items-start gap-2 border-b border-border-subtle py-2 text-danger-fg last:border-0"
    >
      <span aria-hidden="true" className="shrink-0 pt-0.5">⚠</span>
      <div className="min-w-0 flex-1">
        <span className="text-[0.9286rem] font-medium">{name}</span>
        <span className="text-text-tertiary"> — couldn't be read</span>
        <span className="ml-1 text-[0.8571rem] text-danger-fg/90">
          ({entry.error})
        </span>
        <p className="mt-0.5 text-[0.8571rem] text-text-secondary">
          Fix this entry in{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
            .loctt/config/milestones.yaml
          </code>{" "}
          and reload — LocTT will not rewrite it for you.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        testId={`milestone-broken-repair-${idOrIndex}`}
        disabled={repairing}
        onClick={onRepair}
        className="shrink-0"
      >
        Repair
      </Button>
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
      <div data-testid="milestones-panel">
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
  const broken = milestones.data.broken ?? [];

  return (
    <div data-testid="milestones-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Milestones
      </h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Progress is shown on the Milestones view, not here.
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
        <TextField
          aria-label="New milestone name"
          data-testid="milestone-create-name"
          value={name}
          placeholder="New milestone"
          onChange={e => { setName(e.target.value); }}
          className="min-w-0 flex-1"
        />
        <input
          type="date"
          aria-label="New milestone target date"
          data-testid="milestone-create-date"
          value={date}
          onChange={e => { setDate(e.target.value); }}
          className="w-40 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
        />
        <Button
          type="submit"
          variant="secondary"
          testId="milestone-create-submit"
          disabled={name.trim() === "" || create.isPending}
        >
          Create
        </Button>
      </form>

      {create.isError && (
        <p role="alert" className="mb-3 text-[0.8571rem] text-danger-fg">
          {create.error instanceof ApiError ? create.error.message : "Could not create."}
        </p>
      )}

      {items.length === 0 && broken.length === 0
        ? (
            // A lone broken entry is NOT an empty list (DEG-30 / A138) —
            // the list renders below so the corrupt milestone is shown.
            <p data-testid="milestones-empty" data-milestones-state="empty" className="text-[0.9286rem] text-text-tertiary">
              No milestones yet.
            </p>
          )
        : (
            <ul className="m-0 list-none p-0" data-testid="milestones-list">
              {items.map(m => (
                <MilestoneRow key={m.id} milestone={m} count={m.taskCount ?? 0} all={items} />
              ))}
              {/*
                DEG-30: broken entries render as marked error rows after
                the healthy ones, so a corrupt milestone is shown and
                repairable rather than silently omitted.
              */}
              {broken.map(entry => (
                <BrokenMilestoneRow
                  key={`broken-${entry.id ?? `index-${String(entry.index)}`}`}
                  entry={entry}
                  repairing={milestones.isFetching}
                  onRepair={() => { void milestones.refetch(); }}
                />
              ))}
            </ul>
          )}
    </div>
  );
}
