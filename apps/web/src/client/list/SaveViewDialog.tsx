import type { QuerySort } from "@loctt/contracts";
import { useMemo, useState } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useCreateView } from "../api/hooks/useCreateView.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextField } from "../ui/TextField.tsx";
import { buildFiltersFromSearch } from "./buildFilters.ts";
import { buildFacetOptions } from "./facetOptions.ts";
import {
  type CustomFieldLookup,
  resolveFilterRows,
  sortFieldLabel,
} from "./filterPreview.tsx";

/**
 * "Save as view" dialog. Names the current filter set and saves it as a
 * view (`POST /api/views`) whose filters are the active filters, stored
 * as authored (K102).
 *
 * ## The preview (A337)
 *
 * What it shows the user is a HUMAN-READABLE list of the filters being
 * saved — one row per filter — not the DSL. Ken, on the old read-only
 * `Query (from current filters)` code block: *"there's this fucking
 * obsession with the QUERY. QUERY IS ADVANCED SHIT... average people dont
 * need to see the fucking DSL QUERY."* The only row that shows query text
 * is an advanced filter, because that IS what the user typed.
 *
 * A337 replaced a second-generation regression of the same complaint: the
 * rewritten preview still rendered as a monospace DSL-shaped text dump —
 * `project in "01M33FN47B9B55YP89X786V1VB"` — one `<code>` line per
 * filter, via `filterToSummary`. Ken, verbatim, on a screenshot of it:
 * *"why is the filter preview just text?! that's bad UX."* It carried the
 * same two faults the original had: it read as query text rather than the
 * filters the user built, and it printed raw ULIDs (P-4 — no ids in UI
 * content).
 *
 * The rebuilt preview resolves each filter through `filterPreview.tsx`
 * against the SAME `FacetOptions`/workflow config the filter bar and
 * `ViewFormDialog` use, and renders field label + operator ("is any
 * of"/"is not"/…) + resolved values as `Chip`s — the shared pill
 * primitive, not a bespoke look. A value that no longer resolves (a
 * deleted milestone/label/user) renders as a warn-toned degraded chip
 * ("Deleted milestone"), mirroring the filter bar's LST-33 dangling-chip
 * treatment, never the id. An advanced filter is still shown as its own
 * DSL text — legitimate there, since it IS what the user typed — and the
 * view's sort, when the search carries one, gets its own row in the same
 * vocabulary.
 */
export function SaveViewDialog({
  search,
  onClose,
}: {
  readonly search: Partial<ListSearch>;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const createView = useCreateView();
  // The filters as authored — this is exactly what gets stored. Nothing
  // is merged into a query string on the way out.
  const filters = buildFiltersFromSearch(search);

  const sort: QuerySort[] | undefined =
    search.sort !== undefined
      ? [{ field: search.sort, direction: search.dir ?? "asc" }]
      : undefined;
  // The single entry `sort` always carries when defined — extracted once
  // so the preview never needs a non-null assertion to read it.
  const sortEntry = sort?.[0];

  // The same value sources the filter bar and ViewFormDialog resolve
  // against — the dialog cannot show a name the rest of the app could not
  // also show (no second lookup to drift out of sync with).
  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const workflow = useWorkflow();

  const options = useMemo(
    () =>
      buildFacetOptions({
        projects: projects.data?.items ?? [],
        users: users.data?.items ?? [],
        labels: labels.data?.items ?? [],
        milestones: milestones.data?.items ?? [],
        sprints: sprints.data?.items ?? [],
        workflow: workflow.data,
      }),
    [projects.data, users.data, labels.data, milestones.data, sprints.data, workflow.data],
  );

  const customFields = useMemo(() => {
    const m = new Map<string, CustomFieldLookup>();
    for (const cf of workflow.data?.custom_fields ?? []) {
      m.set(cf.key, { label: cf.label, values: cf.values ?? [] });
    }
    return m;
  }, [workflow.data]);

  const resolvedRows = useMemo(
    () => resolveFilterRows(filters, options, customFields),
    // `filters` is a fresh array every render (derived from `search`), so
    // it is intentionally left off the dependency list — its CONTENT is
    // exactly a function of `search`, which is a prop and does not need
    // memoisation churn here; recomputing every render is cheap (a
    // handful of filters, no network).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, options, customFields],
  );

  const submit = (): void => {
    if (name.trim().length === 0) return;
    createView.mutate(
      {
        name: name.trim(),
        filters,
        ...(sort ? { sort } : {}),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="Save as view" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. My open bugs"
          />
        </label>

        <div className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          <span>Filters</span>
          {filters.length === 0 && sortEntry === undefined ? (
            <p
              className="text-[0.8571rem] text-text-tertiary"
              data-testid="save-view-no-filters"
            >
              No filters — this view will show every task.
            </p>
          ) : (
            // A real list — `aria-label`ed rows a screen reader reads as
            // "Project: Web Client" — not a text dump. `role="list"`
            // rather than `<ul>` semantics riding on `<li>` alone, since
            // a row's content is itself a flex layout of chips.
            <ul
              role="list"
              className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-2"
              data-testid="save-view-filter-summary"
            >
              {resolvedRows.map((r, i) => (
                <li
                  // Filters have no id and order is meaningful, so the
                  // index IS the identity here; the list is never
                  // reordered or spliced while mounted.
                  key={i}
                  data-testid="save-view-filter-row"
                  className="text-[0.8571rem] text-text-secondary"
                >
                  {r.kind === "advanced" ? (
                    // The one row that legitimately shows query text: an
                    // advanced filter IS what the user typed (Ken, K102).
                    <div className="flex flex-col gap-0.5">
                      <span className="text-text-tertiary">Advanced query</span>
                      <code
                        className="whitespace-pre-wrap font-mono text-[0.8571rem]"
                        aria-label={`Advanced query: ${r.query}`}
                      >
                        {r.query}
                      </code>
                    </div>
                  ) : (
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      aria-label={
                        r.valueless
                          ? `${r.fieldLabel}: ${r.opLabel}`
                          : `${r.fieldLabel}: ${r.opLabel} ${
                              r.values.map(v => v.label).join(", ")
                            }`
                      }
                    >
                      <span className="font-medium text-text-primary">{r.fieldLabel}</span>
                      <span className="text-text-tertiary">{r.opLabel}</span>
                      {r.valueless ? null : (
                        <span className="flex flex-wrap items-center gap-1" aria-hidden="true">
                          {r.values.map(v => (
                            v.dangling ? (
                              <span
                                key={v.key}
                                title={v.label}
                                className="inline-flex items-center rounded-md bg-warn-bg px-1.5 py-0.5 text-meta italic text-warn-fg"
                              >
                                {v.label}
                              </span>
                            ) : (
                              <Chip key={v.key} variant="accent">{v.label}</Chip>
                            )
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {sortEntry !== undefined && (
                <li
                  data-testid="save-view-sort-row"
                  className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-1.5 text-[0.8571rem] text-text-secondary"
                  aria-label={`Sort: ${sortFieldLabel(sortEntry, customFields)}, ${sortEntry.direction === "asc" ? "ascending" : "descending"}`}
                >
                  <span className="font-medium text-text-primary">Sort</span>
                  <span className="text-text-tertiary">
                    {sortFieldLabel(sortEntry, customFields)}
                    {" · "}
                    {sortEntry.direction === "asc" ? "ascending" : "descending"}
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>

        {createView.isError ? (
          <p className="text-[0.8571rem] text-danger-fg">
            {createView.error instanceof Error ? createView.error.message : "Failed to save view."}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={name.trim().length === 0}
            loading={createView.isPending}
            aria-label="Save"
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
