import type { EditViewRequest, SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Renames a saved view and/or edits its query via `PUT /api/views/:id`
 * (VUE-41 · core `editView`). On success the views query is invalidated
 * so the sidebar and the Saved-views panel pick up the new name/query
 * without a reload.
 *
 * The server route already exists (`handleUpdateView`); this is only the
 * client mutation. `sort: null` clears a stored sort, distinct from
 * `sort: undefined` (leave unchanged) — both are carried through
 * verbatim because the server distinguishes them.
 */
export function useEditView() {
  const qc = useQueryClient();
  return useMutation<SavedQuery, Error, { id: string; body: EditViewRequest }>({
    mutationFn: ({ id, body }) =>
      apiClient.put<SavedQuery>(`/api/views/${encodeURIComponent(id)}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
