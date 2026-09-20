import type { SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";
import { useViews } from "../api/hooks/sidebarData.ts";
import { useDeleteView } from "../api/hooks/useDeleteView.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { RowActions } from "./RowActions.tsx";
import { ViewFormDialog } from "./ViewFormDialog.tsx";

/**
 * Settings → Data → Saved views (VUE-25, VUE-26, VUE-27, VUE-36,
 * XS-66).
 *
 * The DSL editor is M4.5's ticket; this panel is management — list,
 * archive/unarchive, delete — plus the two failure states the saved-view
 * cases care most about:
 *
 *  - **VUE-36 / XS-66**: a `queries.yaml` that will not parse must read
 *    as a *load failure naming the file*, never as "you have no saved
 *    views". The server now returns `config_invalid` with the loader's
 *    own message rather than a generic 500, and this panel keys off
 *    that code so the two are visibly different states.
 *  - **VUE-25**: archived views are excluded from the default listing
 *    but stay runnable by id and can be restored with the same id.
 *
 * `GET /api/views` returns the raw config including archived entries,
 * so the split is done here rather than server-side — the sidebar and
 * this panel want different subsets of the same document.
 */

function useUnarchiveView() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: ({ id }) => apiClient.post(`/api/views/${encodeURIComponent(id)}/unarchive`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["views"] }); },
  });
}

function ViewRow({ view, onEdit }: { readonly view: SavedQuery; readonly onEdit?: (v: SavedQuery) => void }) {
  const del = useDeleteView();
  const unarchive = useUnarchiveView();
  const [confirming, setConfirming] = useState(false);
  const archived = view.archived === true;

  return (
    <li
      // K100 deep-link anchor: a point-of-use "Edit view…" link scrolls
      // to `/settings/saved-views#row-<id>`. `useScrollToHash` resolves it
      // by DOM id, so the row carries one alongside its test id.
      id={`row-${view.id}`}
      data-testid={`view-row-${view.id}`}
      data-view-archived={archived ? "true" : "false"}
      // flex-wrap so on a narrow pane the query drops to its own line
      // instead of a fixed-width chip pushing the actions off-screen
      // (reviewer FAIL). At >= sm it stays a single inline row.
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-0"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
        {view.name}
        {archived && (
          <span data-testid="view-archived-marker" className="ml-2 text-text-tertiary">
            (archived)
          </span>
        )}
      </span>
      {/*
        VUE-26: the query is shown exactly as the file holds it, so a
        view the CLI wrote is visibly the same view. Order-last on mobile
        so it wraps to a full-width line below the name+actions; capped on
        desktop. `min-w-0` lets it truncate rather than force the row wide.
      */}
      <code
        data-testid="view-query"
        className="order-last min-w-0 w-full shrink truncate rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary sm:order-none sm:w-auto sm:max-w-80"
        title={view.query}
      >
        {view.query}
      </code>

      {/* VUE-41: rename + edit-query, on active views. An archived view
          is restored first (its query still resolves by id), so the Edit
          control belongs on the active row. */}
      {/* Row actions collapse into a kebab (responsive GROUP A) so the
          view name + query chip + actions no longer overflow the row.
          Edit only on an active row (an archived view is restored first). */}
      <RowActions
        label={`Actions for view ${view.name}`}
        actions={[
          ...(!archived && onEdit !== undefined
            ? [{ label: "Edit", testId: "view-edit", onSelect: () => { onEdit(view); } }]
            : []),
          archived
            ? { label: "Unarchive", testId: "view-unarchive", disabled: unarchive.isPending, onSelect: () => { unarchive.mutate({ id: view.id }); } }
            : { label: "Archive", testId: "view-archive", disabled: del.isPending, onSelect: () => { del.mutate({ id: view.id, soft: true }); } },
          { label: "Delete", testId: "view-delete", danger: true, onSelect: () => { setConfirming(true); } },
        ]}
      />

      {/* A211 / consistency: the bespoke inline "Delete permanently?" row
          with two secondary buttons is replaced by the shared
          ConfirmDialog the other Data panels use, so the destructive
          confirm reads and behaves the same everywhere (and inherits the
          focus trap + inert background). See decisions.md §8. */}
      {confirming && (
        <ConfirmDialog
          title={`Delete “${view.name}”?`}
          testId="view-delete-dialog"
          confirmTestId="view-delete-confirm"
          confirmLabel="Delete view"
          body={
            <>
              The view <span className="font-medium text-text-primary">{view.name}</span>{" "}
              is deleted permanently. Tasks are not affected, and built-in
              filters are unchanged.
            </>
          }
          // Before this the permanent-delete mutation had no error path:
          // a failed DELETE just left the dialog open with no word of why
          // (the confirm only closes onSuccess). Surface it in the dialog,
          // mirroring RemapDeleteDialog, so a swallowed failure is shown.
          error={del.isError
            ? (del.error instanceof ApiError ? del.error.message : "The view could not be deleted.")
            : undefined}
          onConfirm={() => {
            del.reset();
            del.mutate({ id: view.id }, { onSuccess: () => { setConfirming(false); } });
          }}
          onCancel={() => { del.reset(); setConfirming(false); }}
        />
      )}

      {/* Archive (soft delete) and unarchive are kebab actions with no
          dialog — a failure had nowhere to show and read as done while
          nothing changed on disk (mirrors MilestonesPanel's bug-3 fix).
          Surface it inline on the row. `basis-full` drops it to its own
          line under the flex row. */}
      {del.isError && !confirming && (
        <Callout tone="danger" role="alert" testId="view-archive-error" className="basis-full">
          {del.error instanceof ApiError ? del.error.message : "The view could not be archived."}
        </Callout>
      )}
      {unarchive.isError && (
        <Callout tone="danger" role="alert" testId="view-unarchive-error" className="basis-full">
          {unarchive.error instanceof ApiError ? unarchive.error.message : "The view could not be unarchived."}
        </Callout>
      )}
    </li>
  );
}

export function SavedViewsPanel() {
  const views = useViews();
  // VUE-40 (create) and VUE-41 (edit) share one dialog: `null` closed,
  // `{ mode: "create" }` a new view, `{ mode: "edit", view }` a rename /
  // edit-query of an existing one.
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; view: SavedQuery } | null
  >(null);

  if (views.isError) {
    /*
      VUE-36 / XS-66. The server distinguishes a malformed file
      (`config_invalid`, carrying `queries.yaml is not valid: …` or
      `duplicate query id: …`) from an unreachable server, and this
      panel must not collapse either into an empty list — a user whose
      file has one bad entry must not conclude their views were deleted.
    */
    const envelope = views.error instanceof ApiError ? views.error.envelope : undefined;
    const isConfigInvalid = envelope?.code === "config_invalid";
    return (
      <div data-testid="saved-views-panel">
        <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
          Saved views
        </h1>
        <div
          data-testid="saved-views-load-error"
          data-views-state={isConfigInvalid ? "config-invalid" : "unreachable"}
        >
          <ErrorState
            error={views.error}
            onRetry={() => { void views.refetch(); }}
            context={
              isConfigInvalid
                ? "reading .loctt/config/queries.yaml"
                : "the saved views"
            }
          />
          {isConfigInvalid && (
            <p className="mt-2 text-[0.9286rem] text-text-secondary">
              Your saved views have not been deleted — the file could not be
              parsed, so none of them could be loaded. Fix{" "}
              <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                .loctt/config/queries.yaml
              </code>{" "}
              and reload. Built-in filters are unaffected, since they do not
              come from this file.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (views.isLoading || views.data === undefined) {
    return <LoadingState>Loading saved views…</LoadingState>;
  }

  const all = views.data.queries;
  const active = all.filter(v => v.archived !== true);
  const archived = all.filter(v => v.archived === true);
  // VUE-22 / north-star principle 5: views present in queries.yaml whose
  // query no longer parses. Listed here marked broken rather than hidden,
  // so a hand edit that breaks one view does not read as "it was deleted".
  const broken = views.data.broken ?? [];

  return (
    <div data-testid="saved-views-panel">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 data-testid="settings-panel-title" className="text-lg font-semibold text-text-primary">
          Saved views
        </h1>
        {/* VUE-40: create a saved view from the UI. This is the panel's
            entry point; the sidebar's "+ New filter" opens the same
            dialog once the Sidebar lane wires it (see handoff note). */}
        <Button
          variant="primary"
          size="sm"
          testId="saved-views-new"
          onClick={() => { setDialog({ mode: "create" }); }}
        >
          + New view
        </Button>
      </div>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Archived views stay runnable by their URL but are hidden
        from the sidebar.
      </p>

      {dialog !== null && (
        <ViewFormDialog
          {...(dialog.mode === "edit" ? { existing: dialog.view } : {})}
          onClose={() => { setDialog(null); }}
        />
      )}

      {all.length === 0 && broken.length === 0
        ? (
            <p data-testid="saved-views-empty" data-views-state="empty" className="text-[0.9286rem] text-text-tertiary">
              No saved views yet.
            </p>
          )
        : (
            <>
              <ul className="m-0 list-none p-0" data-testid="saved-views-list">
                {active.map(v => (
                  <ViewRow key={v.id} view={v} onEdit={vv => { setDialog({ mode: "edit", view: vv }); }} />
                ))}
              </ul>

              {archived.length > 0 && (
                <>
                  <h2 className="mb-1 mt-5 text-[0.9286rem] font-semibold text-text-primary">
                    Archived
                  </h2>
                  <ul className="m-0 list-none p-0" data-testid="saved-views-archived-list">
                    {/* Archived rows have no Edit (restore first); omit
                        onEdit rather than passing a no-op. */}
                    {archived.map(v => <ViewRow key={v.id} view={v} />)}
                  </ul>
                </>
              )}

              {broken.length > 0 && (
                <>
                  <h2 className="mb-1 mt-5 text-[0.9286rem] font-semibold text-danger-fg">
                    Broken
                  </h2>
                  <p className="mb-2 text-[0.8571rem] text-text-secondary">
                    These views are still in the file, but their query no longer
                    parses. Fix them from the list view or by hand in{" "}
                    <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                      .loctt/config/queries.yaml
                    </code>.
                  </p>
                  <ul className="m-0 list-none p-0" data-testid="saved-views-broken-list">
                    {broken.map(b => (
                      <li
                        key={b.id}
                        id={`row-${b.id}`}
                        data-testid={`view-row-${b.id}`}
                        data-view-broken="true"
                        className="flex flex-col gap-0.5 border-b border-border-subtle py-2 last:border-0"
                      >
                        <span className="text-[0.9286rem] font-medium text-text-primary">
                          {b.name}
                          <span data-testid="view-broken-marker" className="ml-2 text-danger-fg">
                            (broken)
                          </span>
                        </span>
                        <code className="text-[0.8571rem] text-text-secondary">{b.query}</code>
                        <span className="text-[0.8571rem] text-danger-fg">
                          {b.error}
                          {b.position !== undefined ? ` (at position ${String(b.position)})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
    </div>
  );
}
