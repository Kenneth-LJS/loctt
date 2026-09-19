import { useState } from "react";

import { useCreateView } from "../api/hooks/useCreateView.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextField } from "../ui/TextField.tsx";
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

        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Query (from current filters)
          <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-2 text-[0.8571rem] text-text-secondary">
            {query}
          </code>
        </label>

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
            {createView.isPending ? "Saving…" : "Save view"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
