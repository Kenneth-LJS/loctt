// Imported by subpath, NOT the barrel: the barrel drags node:path/sharp
// into the browser bundle (see buildDsl.ts / dslToSearch.ts, A37).
import { filterToSummary } from "@loctt/core/query/filters.js";
import { useState } from "react";

import { useCreateView } from "../api/hooks/useCreateView.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextField } from "../ui/TextField.tsx";
import { archivedScopeFromSearch, buildFiltersFromSearch } from "./buildFilters.ts";

/** How the archived scope reads in the summary list. */
const SCOPE_LABEL: Readonly<Record<string, string>> = {
  archived: "Archived tasks only",
  all: "Active and archived tasks",
};

/**
 * "Save as view" dialog. Names the current filter set and saves it as a
 * view (`POST /api/views`) whose filters are the active filters, stored
 * as authored (K102).
 *
 * What it shows the user is a HUMAN-READABLE list of the filters being
 * saved — one row per filter — not the DSL. Ken, on the old read-only
 * `Query (from current filters)` code block: *"there's this fucking
 * obsession with the QUERY. QUERY IS ADVANCED SHIT... average people dont
 * need to see the fucking DSL QUERY."* The only row that shows query text
 * is an advanced filter, because that IS what the user typed.
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
  const archivedScope = archivedScopeFromSearch(search);

  const sort =
    search.sort !== undefined
      ? [{ field: search.sort, direction: search.dir ?? "asc" }]
      : undefined;

  const submit = (): void => {
    if (name.trim().length === 0) return;
    createView.mutate(
      {
        name: name.trim(),
        filters,
        ...(sort ? { sort } : {}),
        ...(archivedScope !== undefined ? { archivedScope } : {}),
      },
      { onSuccess: onClose },
    );
  };

  const scopeLabel = archivedScope !== undefined ? SCOPE_LABEL[archivedScope] : undefined;

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
          {filters.length === 0 && scopeLabel === undefined ? (
            <p
              className="text-[0.8571rem] text-text-tertiary"
              data-testid="save-view-no-filters"
            >
              No filters — this view will show every task.
            </p>
          ) : (
            <ul
              className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-2"
              data-testid="save-view-filter-summary"
            >
              {filters.map((f, i) => (
                <li
                  // Filters have no id and order is meaningful, so the
                  // index IS the identity here; the list is never
                  // reordered or spliced while mounted.
                  key={i}
                  className="text-[0.8571rem] text-text-secondary"
                >
                  {f.kind === "advanced" ? (
                    <code className="whitespace-pre-wrap">{f.query}</code>
                  ) : (
                    filterToSummary(f)
                  )}
                </li>
              ))}
              {scopeLabel !== undefined ? (
                <li className="text-[0.8571rem] text-text-tertiary">{scopeLabel}</li>
              ) : null}
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
            disabled={name.trim().length === 0 || createView.isPending}
          >
            {createView.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
