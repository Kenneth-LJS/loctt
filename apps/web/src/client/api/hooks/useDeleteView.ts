import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Deletes a saved view via `DELETE /api/views/:id` (VUE-38 · core
 * `deleteView`). On success the views query is invalidated so the sidebar
 * and the Saved-views panel drop the row without a reload.
 *
 * `soft: true` archives instead of hard-deleting (`?soft=true`) — the
 * entry stays in `queries.yaml`, hidden from the sidebar but runnable by
 * id, matching `SavedViewsPanel`'s Archive action. Omit `soft` for a hard
 * delete.
 *
 * Lifted out of two inline copies (the `SavedViewsPanel` module-local
 * `useDeleteView` and the `SidebarPinsPanel` inline mutation) so all three
 * call sites — sidebar rows, the Saved-views panel and the pins panel —
 * hit the same endpoint and invalidate the same key. Adding a delete for
 * one surface without the others is the core/surface drift the repo warns
 * against.
 */
export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; soft?: boolean }>({
    mutationFn: ({ id, soft }) =>
      apiClient.delete(
        `/api/views/${encodeURIComponent(id)}${soft === true ? "?soft=true" : ""}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
