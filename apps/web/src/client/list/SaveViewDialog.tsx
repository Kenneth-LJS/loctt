import { useState } from "react";

import { useCreateView } from "../api/hooks/useCreateView.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { Modal } from "../ui/Modal.tsx";
import { buildDslFromSearch } from "./buildDsl.ts";

/**
 * Basic-mode "Save as view" dialog (M1.3). Names the current filter
 * set and saves it as a query view (`POST /api/views`) whose DSL is
 * derived from the active filters. The advanced raw-DSL editor is M4 —
 * here the query is shown read-only so the user sees what they're
 * saving, plus the current sort is carried over.
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
  const query = buildDslFromSearch(search);

  const sort =
    search.sort !== undefined
      ? [{ field: search.sort, direction: search.dir ?? "asc" }]
      : undefined;

  const submit = (): void => {
    if (name.trim().length === 0) return;
    createView.mutate(
      { name: name.trim(), query, ...(sort ? { sort } : {}) },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="Save as view" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          Name
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. My open bugs"
            className="h-8 rounded-md border border-border-default bg-bg-surface px-2.5 text-[13px] text-text-primary focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          Query (from current filters)
          <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-2 font-mono text-[12px] text-text-secondary">
            {query}
          </code>
        </label>

        {createView.isError ? (
          <p className="text-[12px] text-danger-fg">
            {createView.error instanceof Error ? createView.error.message : "Failed to save view."}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border-default px-3 text-[13px] text-text-secondary hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={name.trim().length === 0 || createView.isPending}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createView.isPending ? "Saving…" : "Save view"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
