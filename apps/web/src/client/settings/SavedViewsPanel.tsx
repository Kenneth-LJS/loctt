import type { SavedQuery } from "@loctt/contracts";
// Per-file subpath, NOT the barrel: the barrel drags node:path into the
// browser bundle (A37).
import { filtersToSummary } from "@loctt/core/query/filters.js";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useViewsScoped } from "../api/hooks/sidebarData.ts";
import { useDeleteView } from "../api/hooks/useDeleteView.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";
import { type BrokenViewContext, ViewFormDialog, type ViewFormTarget } from "./ViewFormDialog.tsx";

/**
 * Settings → Data → Saved views (VUE-25, VUE-26, VUE-27, VUE-36,
 * XS-66).
 *
 * The DSL editor is M4.5's ticket; this panel is management — list,
 * archive, delete — plus the two failure states the saved-view
 * cases care most about:
 *
 *  - **VUE-36 / XS-66**: a `queries.yaml` that will not parse must read
 *    as a *load failure naming the file*, never as "you have no saved
 *    views". The server now returns `config_invalid` with the loader's
 *    own message rather than a generic 500, and this panel keys off
 *    that code so the two are visibly different states.
 *  - **VUE-25**: archived views are excluded from this listing (K121 #1:
 *    they are listed and restored with the same id in Settings →
 *    Archived, nowhere else).
 */

function ViewRow({ view, onEdit }: { readonly view: SavedQuery; readonly onEdit: (v: SavedQuery) => void }) {
  const del = useDeleteView();
  const [confirming, setConfirming] = useState(false);
  const summary = filtersToSummary(view.filters);

  return (
    <li
      // K100 deep-link anchor: a point-of-use "Edit view…" link scrolls
      // to `/settings/saved-views#row-<id>`. `useScrollToHash` resolves it
      // by DOM id, so the row carries one alongside its test id.
      id={`row-${view.id}`}
      data-testid={`view-row-${view.id}`}
      // flex-wrap so on a narrow pane the query drops to its own line
      // instead of a fixed-width chip pushing the actions off-screen
      // (reviewer FAIL). At >= sm it stays a single inline row.
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-0"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
        {view.name}
      </span>
      {/*
        VUE-26: what the view matches, shown exactly as the file holds it,
        so a view the CLI wrote is visibly the same view. K102: a view no
        longer stores a query string, so the row renders the shared
        display-only summary of its ordered filters — computed here, never
        persisted and never parsed back. Order-last on mobile so it wraps
        to a full-width line below the name+actions; capped on desktop.
        `min-w-0` lets it truncate rather than force the row wide.
      */}
      <code
        data-testid="view-query"
        className="order-last min-w-0 w-full shrink truncate rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary sm:order-none sm:w-auto sm:max-w-80"
        title={summary}
      >
        {summary}
      </code>

      {/* VUE-41: rename + edit-query. Row actions collapse into a kebab
          (responsive GROUP A) so the view name + query chip + actions no
          longer overflow the row. */}
      <RowActions
        label={`Actions for view ${view.name}`}
        actions={[
          { label: "Edit", testId: "view-edit", onSelect: () => { onEdit(view); } },
          { label: "Archive", testId: "view-archive", disabled: del.isPending, onSelect: () => { del.mutate({ id: view.id, soft: true }); } },
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
              Deletes &quot;<span className="font-medium text-text-primary">{view.name}</span>&quot;{" "}
              permanently. Tasks aren&apos;t affected.
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

      {/* Archive (soft delete) is a kebab action with no
          dialog — a failure had nowhere to show and read as done while
          nothing changed on disk (mirrors MilestonesPanel's bug-3 fix).
          Surface it inline on the row. `basis-full` drops it to its own
          line under the flex row. */}
      {del.isError && !confirming && (
        <Callout tone="danger" role="alert" testId="view-archive-error" className="basis-full">
          {del.error instanceof ApiError ? del.error.message : "The view could not be archived."}
        </Callout>
      )}
    </li>
  );
}

export function SavedViewsPanel() {
  // K121 #1: active views only. Archived ones are listed, restored and
  // deleted in Settings → Archived, nowhere else.
  const views = useViewsScoped();
  // VUE-40 (create) and VUE-41 (edit) share one dialog: `null` closed,
  // `{ mode: "create" }` a new view, `{ mode: "edit", view }` a rename /
  // edit-query of an existing one.
  //
  // A broken entry can also be opened here, and when it is, the dialog
  // gets its `broken` context: the parse error plus the YAML still on
  // disk in `rawText`, with Save held inert behind an explicit
  // confirmation. This panel never had a plain Edit on a broken row, so
  // it never carried the sidebar's silent-overwrite defect — but it also
  // showed the user nothing they could act on beyond "go edit the file",
  // without showing them the file. Same dialog, same guard.
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; view: ViewFormTarget; broken?: BrokenViewContext }
    | null
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
        <SettingsPanelHeader title="Saved views" />
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
              Couldn&apos;t read{" "}
              <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                .loctt/config/queries.yaml
              </code>
              , so saved views aren&apos;t shown. They haven&apos;t been deleted. Fix
              the file and reload.
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
  // VUE-22 / north-star principle 5: views present in queries.yaml whose
  // query no longer parses. Listed here marked broken rather than hidden,
  // so a hand edit that breaks one view does not read as "it was deleted".
  const broken = views.data.broken ?? [];

  return (
    <div data-testid="saved-views-panel">
      {/* VUE-40: create a saved view from the UI. This is the panel's
          entry point; the sidebar's "+ New filter" opens the same
          dialog once the Sidebar lane wires it (see handoff note). */}
      <SettingsPanelHeader
        title="Saved views"
        actions={(
          <Button
            variant="primary"
            testId="saved-views-new"
            onClick={() => { setDialog({ mode: "create" }); }}
          >
            New view
          </Button>
        )}
      />
      {dialog !== null && (
        <ViewFormDialog
          {...(dialog.mode === "edit" ? { existing: dialog.view } : {})}
          {...(dialog.mode === "edit" && dialog.broken !== undefined
            ? { broken: dialog.broken }
            : {})}
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
                {all.map(v => (
                  <ViewRow key={v.id} view={v} onEdit={vv => { setDialog({ mode: "edit", view: vv }); }} />
                ))}
              </ul>

              {broken.length > 0 && (
                <>
                  <h2 className="mb-1 mt-5 text-[0.9286rem] font-semibold text-danger-fg">
                    Broken
                  </h2>
                  <p className="mb-2 text-[0.8571rem] text-text-secondary">
                    Fix this view in{" "}
                    <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                      .loctt/config/queries.yaml
                    </code>
                    , or replace it below.
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
                        <code className="text-[0.8571rem] text-text-secondary">{b.summary}</code>
                        <span className="text-[0.8571rem] text-danger-fg">
                          {b.error}
                          {b.position !== undefined ? ` (at position ${String(b.position)})` : ""}
                        </span>
                        {/* The bytes still on disk. This is the only
                            surviving record of what the user meant, so it
                            is shown rather than described — "fix it in the
                            file" is not actionable advice without it. */}
                        <pre
                          data-testid={`view-broken-raw-${b.id}`}
                          className="m-0 mt-1 overflow-x-auto rounded bg-bg-muted px-2 py-1 font-mono text-[0.7857rem] text-text-secondary"
                        >
                          {b.rawText}
                        </pre>
                        <div className="mt-1">
                          {/* Deliberately labelled "Replace", not
                              "Edit": whatever is built in the dialog
                              REPLACES the text above, and the dialog
                              makes the user confirm that before it will
                              save. */}
                          <Button
                            variant="secondary"
                            size="sm"
                            testId={`view-broken-replace-${b.id}`}
                            onClick={() => {
                              setDialog({
                                mode: "edit",
                                view: { id: b.id, name: b.name, filters: [] },
                                broken: {
                                  error: b.error,
                                  rawText: b.rawText,
                                  ...(b.position !== undefined ? { position: b.position } : {}),
                                },
                              });
                            }}
                          >
                            Replace
                          </Button>
                        </div>
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
