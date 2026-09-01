import type { SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";
import { useViews } from "../api/hooks/sidebarData.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

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

function useDeleteView() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; soft?: boolean }>({
    mutationFn: ({ id, soft }) =>
      apiClient.delete(`/api/views/${encodeURIComponent(id)}${soft === true ? "?soft=true" : ""}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["views"] }); },
  });
}

function useUnarchiveView() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: ({ id }) => apiClient.post(`/api/views/${encodeURIComponent(id)}/unarchive`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["views"] }); },
  });
}

function ViewRow({ view }: { readonly view: SavedQuery }) {
  const del = useDeleteView();
  const unarchive = useUnarchiveView();
  const [confirming, setConfirming] = useState(false);
  const archived = view.archived === true;

  return (
    <li
      data-testid={`view-row-${view.id}`}
      data-view-archived={archived ? "true" : "false"}
      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
        {view.name}
        {archived && (
          <span data-testid="view-archived-marker" className="ml-2 text-text-tertiary">
            (archived)
          </span>
        )}
      </span>
      {/*
        VUE-26: the query is shown exactly as the file holds it, so a
        view the CLI wrote is visibly the same view.
      */}
      <code
        data-testid="view-query"
        className="w-80 shrink-0 truncate rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] text-text-secondary"
        title={view.query}
      >
        {view.query}
      </code>

      {archived
        ? (
            <button
              type="button"
              data-testid="view-unarchive"
              disabled={unarchive.isPending}
              onClick={() => { unarchive.mutate({ id: view.id }); }}
              className="rounded border border-border-subtle px-2 py-1 text-[12px] disabled:opacity-50"
            >
              Unarchive
            </button>
          )
        : (
            <button
              type="button"
              data-testid="view-archive"
              disabled={del.isPending}
              onClick={() => { del.mutate({ id: view.id, soft: true }); }}
              className="rounded border border-border-subtle px-2 py-1 text-[12px] disabled:opacity-50"
            >
              Archive
            </button>
          )}

      {confirming
        ? (
            <span className="flex shrink-0 items-center gap-2 text-[12px]">
              <span className="text-text-secondary">Delete permanently?</span>
              <button
                type="button"
                data-testid="view-delete-confirm"
                disabled={del.isPending}
                onClick={() => {
                  del.mutate({ id: view.id }, { onSuccess: () => { setConfirming(false); } });
                }}
                className="rounded border border-border-subtle px-2 py-1 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); }}
                className="rounded border border-border-subtle px-2 py-1"
              >
                Cancel
              </button>
            </span>
          )
        : (
            <button
              type="button"
              data-testid="view-delete"
              onClick={() => { setConfirming(true); }}
              className="rounded border border-border-subtle px-2 py-1 text-[12px]"
            >
              Delete
            </button>
          )}
    </li>
  );
}

export function SavedViewsPanel() {
  const views = useViews();

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
      <div className="p-8" data-testid="saved-views-panel">
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
            <p className="mt-2 text-[13px] text-text-secondary">
              Your saved views have not been deleted — the file could not be
              parsed, so none of them could be loaded. Fix{" "}
              <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
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
    return <div className="p-8 text-[13px] text-text-tertiary">Loading saved views…</div>;
  }

  const all = views.data.queries;
  const active = all.filter(v => v.archived !== true);
  const archived = all.filter(v => v.archived === true);

  return (
    <div className="p-8" data-testid="saved-views-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Saved views
      </h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Stored in{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
          .loctt/config/queries.yaml
        </code>. Archived views stay runnable by their URL but are hidden
        from the sidebar.
      </p>

      {all.length === 0
        ? (
            <p data-testid="saved-views-empty" data-views-state="empty" className="text-[13px] text-text-tertiary">
              No saved views yet.
            </p>
          )
        : (
            <>
              <ul className="m-0 list-none p-0" data-testid="saved-views-list">
                {active.map(v => <ViewRow key={v.id} view={v} />)}
              </ul>

              {archived.length > 0 && (
                <>
                  <h2 className="mb-1 mt-5 text-[13px] font-semibold text-text-primary">
                    Archived
                  </h2>
                  <ul className="m-0 list-none p-0" data-testid="saved-views-archived-list">
                    {archived.map(v => <ViewRow key={v.id} view={v} />)}
                  </ul>
                </>
              )}
            </>
          )}
    </div>
  );
}
