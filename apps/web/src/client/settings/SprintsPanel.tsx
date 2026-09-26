import type { BrokenEntry, SprintDef } from "@loctt/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useArchiveSprint, useCountedSprints, useDeleteSprint } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { dataStateOf, InlineFailureNotice } from "../ui/InlineFailureNotice.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";
import { SprintEditDialog } from "./SprintEditDialog.tsx";

/**
 * Settings → Data → Sprints (SPR-40).
 *
 * Full management: **create** and **edit** (both via the shared
 * {@link SprintEditDialog} — K105), **delete** (with remap of referencing
 * tasks), the burndown link, and archive. The panel was
 * read-and-navigate before; SPR-40 brought it to CLI parity for the
 * lifecycle operations, and K105 folds the create form and the per-row
 * edit into the one dialog the sidebar can also render, so the sprint form
 * exists in exactly one place.
 *
 * The sprint detail route (M4.7) still carries metadata editing inline via
 * `SprintMetaHeader` for the burndown page; both surfaces now go through
 * the same `useUpdateSprintMeta` combined-patch hook (A147), so they cannot
 * write different shapes.
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

/**
 * A328 (B6): the archive-toggle row notice, verbatim from the decision.
 * `attemptedArchive` is the state the click was trying to reach (the
 * mutation's `archived` var), since a failure leaves the row's own
 * `archived` unchanged from before the click.
 */
export function archiveFailureMessage(name: string, attemptedArchive: boolean, error: unknown): string {
  const verb = attemptedArchive ? "archived" : "unarchived";
  return dataStateOf(error) === "unknown"
    ? `Couldn't confirm ${name} was ${verb}. Reload to check.`
    : `${name} wasn't ${verb}. Try again.`;
}

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
  const [editing, setEditing] = useState(false);
  const count = sprint.taskCount ?? 0;

  return (
    <li
      // K100 deep-link anchor (`/settings/sprints#row-<id>`) — see
      // useScrollToHash.
      id={`row-${sprint.id}`}
      data-testid={`sprint-row-${sprint.id}`}
      data-sprint-state={sprint.state}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-0"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
        {sprint.name}
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
          overflow the row on a narrow pane (responsive GROUP A). Edit
          (name/dates/goal/state, via the shared dialog — K105), Burndown
          (navigation), Archive, and Delete. Restoring an archived sprint is
          Settings → Archived (K121 #1). */}
      <div className="shrink-0">
        <RowActions
          label={`Actions for sprint ${sprint.name}`}
          actions={[
            { label: "Edit", testId: "sprint-edit", onSelect: () => { setEditing(true); } },
            { label: "Open burndown", testId: "sprint-burndown-link", onSelect: () => { void navigate({ to: "/sprints/$key", params: { key: sprint.id } }); } },
            {
              label: "Archive",
              testId: "sprint-archive-toggle",
              disabled: archive.isPending,
              onSelect: () => { archive.mutate({ id: sprint.id, archived: true }); },
            },
            { label: "Delete", testId: "sprint-delete", danger: true, onSelect: () => { setConfirmingDelete(true); } },
          ]}
        />
      </div>

      {editing && (
        // K100/K105: the same shared dialog the panel's create uses — the
        // sprint edit form lives in exactly one place.
        <SprintEditDialog
          mode="edit"
          existing={sprint}
          onClose={() => { setEditing(false); }}
        />
      )}

      {/* A328 (B6): archive never read `archive.error` before —
          a timed-out or rejected toggle did nothing visible and the row
          looked unchanged. Named per the sprint (messaging.md wants the
          number/name where there is one), with Try again re-firing the
          same toggle. */}
      {archive.isError && (
        <div className="basis-full">
          <InlineFailureNotice
            testId="sprint-archive-error"
            message={archiveFailureMessage(sprint.name, true, archive.error)}
            dataState={dataStateOf(archive.error)}
            onRetry={() => { archive.mutate({ id: sprint.id, archived: true }); }}
          />
        </div>
      )}

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
            .filter(s => s.id !== sprint.id)
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

/**
 * DEG-30 / A138 parity: a sprint whose stored fields do not validate is
 * lifted by the tolerant loader into `broken` and rides the list endpoint
 * (`handleListSprints`) rather than being dropped. It renders as a
 * disabled, marked error row mirroring `BrokenLabelRow`/`BrokenMilestoneRow`,
 * so a corrupt sprint is visible and repairable instead of silently
 * vanishing (corruption-guide § 4.6). Repair (reload-from-disk), not
 * Delete, for the same reason as labels/milestones (A202).
 */
function BrokenSprintRow({ entry, onRepair, repairing }: {
  readonly entry: BrokenEntry;
  readonly onRepair: () => void;
  readonly repairing: boolean;
}) {
  const name = entry.id ?? `Sprint entry #${String(entry.index + 1)}`;
  const idOrIndex = entry.id ?? `index-${String(entry.index)}`;
  return (
    <li
      {...(entry.id !== undefined ? { id: `row-${entry.id}` } : {})}
      data-testid={`sprint-broken-${idOrIndex}`}
      data-broken-sprint={idOrIndex}
      aria-disabled="true"
      className="flex items-start gap-2 border-b border-border-subtle py-2 text-danger-fg last:border-0"
    >
      <span aria-hidden="true" className="shrink-0 pt-0.5">⚠</span>
      <div className="min-w-0 flex-1">
        <span className="text-[0.9286rem] font-medium">{name}</span>
        <p className="mt-0.5 text-[0.8571rem] text-text-secondary">
          Couldn&apos;t be read ({entry.error}). Fix it in{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
            .loctt/config/sprints.yaml
          </code>{" "}
          and reload.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        testId={`sprint-broken-repair-${idOrIndex}`}
        disabled={repairing}
        onClick={onRepair}
        className="shrink-0"
      >
        Repair
      </Button>
    </li>
  );
}

export function SprintsPanel() {
  const [creating, setCreating] = useState(false);
  // K121 #1: active sprints only. Archived ones are listed, restored and
  // deleted in Settings → Archived, nowhere else.
  const sprints = useCountedSprints();

  if (sprints.isError) {
    return (
      <div data-testid="sprints-panel">
        <SettingsPanelHeader title="Sprints" />
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
  // DEG-30 / A138: sprints present in sprints.yaml whose stored fields no
  // longer validate. Rendered in their own marked block rather than
  // hidden, so a hand edit that breaks one does not read as "deleted".
  const broken = sprints.data.broken ?? [];

  return (
    <div data-testid="sprints-panel">
      {/* SPR-40/K105: create runs through the shared SprintEditDialog — the
          same dialog the per-row Edit action opens, so the create and edit
          forms cannot drift. */}
      <SettingsPanelHeader
        title="Sprints"
        actions={(
          <Button
            variant="primary"
            testId="sprint-create-open"
            onClick={() => { setCreating(true); }}
          >
            New sprint
          </Button>
        )}
      />
      {creating && (
        <SprintEditDialog
          mode="create"
          onClose={() => { setCreating(false); }}
        />
      )}

      {items.length === 0 && broken.length === 0
        ? (
            // A lone broken entry is NOT an empty list (DEG-30 / A138) —
            // its block renders below.
            <p data-testid="sprints-empty" data-sprints-state="empty" className="text-[0.9286rem] text-text-tertiary">
              No sprints yet.
            </p>
          )
        : items.length > 0 && (
            <ul className="m-0 list-none p-0" data-testid="sprints-list">
              {items.map(s => <SprintRow key={s.id} sprint={s} all={items} />)}
            </ul>
          )}

      {broken.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-1 text-[0.9286rem] font-semibold text-danger-fg">
            Broken
          </h2>
          <p className="mb-2 text-[0.8571rem] text-text-secondary">
            These sprints have invalid fields. Fix them in{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              .loctt/config/sprints.yaml
            </code>{" "}
            and reload.
          </p>
          <ul className="m-0 list-none p-0" data-testid="sprints-broken-list">
            {broken.map(entry => (
              <BrokenSprintRow
                key={`broken-${entry.id ?? `index-${String(entry.index)}`}`}
                entry={entry}
                repairing={sprints.isFetching}
                onRepair={() => { void sprints.refetch(); }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
