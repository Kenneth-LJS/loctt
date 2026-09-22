import type { EditViewRequest, SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Edit-view request body. As with create, K102 unified the shape across
 * surfaces, so the contracts type is used directly. `filters` replaces
 * the whole ordered list; omitting it leaves the view's filters alone.
 */
export type EditViewBody = EditViewRequest;

/**
 * Renames a saved view and/or edits its filters via `PUT /api/views/:id`
 * (VUE-41 · core `editView`). On success the views query is invalidated
 * so the sidebar and the Saved-views panel pick up the new name/filters
 * without a reload.
 *
 * The server route already exists (`handleUpdateView`); this is only the
 * client mutation. `sort: null` clears a stored sort, distinct from
 * `sort: undefined` (leave unchanged) — both are carried through
 * verbatim because the server distinguishes them.
 */
export function useEditView() {
  const qc = useQueryClient();
  return useMutation<SavedQuery, Error, { id: string; body: EditViewBody }>({
    mutationFn: ({ id, body }) =>
      apiClient.put<SavedQuery>(`/api/views/${encodeURIComponent(id)}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
