import type { ArchivedScope, BrokenEntry, SprintDef } from "@loctt/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useArchiveSprint, useCountedSprints, useDeleteSprint } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { ArchivedScopeReveal } from "./ArchivedScopeReveal.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";
import { SprintEditDialog } from "./SprintEditDialog.tsx";

/**
 * Settings → Data → Sprints (SPR-40).
 *
 * Full management: **create** and **edit** (both via the shared
 * {@link SprintEditDialog} — K105), **delete** (with remap of referencing
 * tasks), the burndown link, and the archived split. The panel was
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
  const archived = sprint.archived === true;

  return (
    <li
      // K100 deep-link anchor (`/settings/sprints#row-<id>`) — see
      // useScrollToHash. An archived sprint's row only mounts once the
      // "Show archived" toggle is on, which the panel auto-enables when the
      // hash names an archived sprint (see SprintsPanel below).
      id={`row-${sprint.id}`}
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
          overflow the row on a narrow pane (responsive GROUP A). Edit
          (name/dates/goal/state, via the shared dialog — K105), Burndown
          (navigation), Archive/Unarchive, and Delete. */}
      <div className="shrink-0">
        <RowActions
          label={`Actions for sprint ${sprint.name}`}
          actions={[
            { label: "Edit…", testId: "sprint-edit", onSelect: () => { setEditing(true); } },
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

      {editing && (
        // K100/K105: the same shared dialog the panel's create uses — the
        // sprint edit form lives in exactly one place.
        <SprintEditDialog
          mode="edit"
          existing={sprint}
          onClose={() => { setEditing(false); }}
        />
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
        <span className="text-text-tertiary"> — couldn't be read</span>
        <span className="ml-1 text-[0.8571rem] text-danger-fg/90">
          ({entry.error})
        </span>
        <p className="mt-0.5 text-[0.8571rem] text-text-secondary">
          Fix this entry in{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
            .loctt/config/sprints.yaml
          </code>{" "}
          and reload — LocTT will not rewrite it for you.
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
  // K107: the tri-state archived scope replaces the old `showArchived`
  // boolean. Default `active` (hide archived); the control reveals
  // `archived`/`all`, and the server does the filtering.
  const [scope, setScope] = useState<ArchivedScope>("active");

  // K100 archived-row anchor. A deep link to an archived sprint
  // (`#row-<id>`) targets a row the default `active` scope does not fetch,
  // so `useScrollToHash` would find nothing. When a hash is present we
  // widen the fetch to `all` so the anchor can resolve. Additive: only
  // ever widens, and only while a hash is in play, so it never fights the
  // user's own scope choice during ordinary browsing.
  const hash = useRouterState({ select: s => s.location.hash });
  const hashPresent = hash !== undefined && hash !== "" && hash.replace(/^#/, "") !== "";
  const effectiveScope: ArchivedScope = hashPresent ? "all" : scope;
  const sprints = useCountedSprints(effectiveScope);

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
  const activeItems = items.filter(s => s.archived !== true);
  const archivedItems = items.filter(s => s.archived === true);
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
          <>
            {/* Ken's ruling, 2026-09-22 (decisions.md § 9): demoted behind
                an icon reveal, not a permanently visible segmented
                control — see ArchivedScopeReveal. */}
            <ArchivedScopeReveal
              testId="sprints-archived-scope"
              panelLabel="sprints"
              value={scope}
              onChange={setScope}
            />
            <Button
              variant="primary"
              testId="sprint-create-open"
              onClick={() => { setCreating(true); }}
            >
              New sprint
            </Button>
          </>
        )}
      />
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Create, edit and delete sprints here, or open one for its burndown.
      </p>

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
              {scope === "archived" ? "No archived sprints." : "No sprints yet."}
            </p>
          )
        : activeItems.length > 0 && (
            <ul className="m-0 list-none p-0" data-testid="sprints-list">
              {activeItems.map(s => <SprintRow key={s.id} sprint={s} all={items} />)}
            </ul>
          )}

      {archivedItems.length > 0 && (
        <div className="mt-5">
          <ul className="m-0 list-none p-0" data-testid="sprints-archived-list">
            {archivedItems.map(s => <SprintRow key={s.id} sprint={s} all={items} />)}
          </ul>
        </div>
      )}

      {broken.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-1 text-[0.9286rem] font-semibold text-danger-fg">
            Broken
          </h2>
          <p className="mb-2 text-[0.8571rem] text-text-secondary">
            These sprints are still in the file, but their stored fields no
            longer validate. Fix them by hand in{" "}
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
