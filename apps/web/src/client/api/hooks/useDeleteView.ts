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
  return useMutation<unknown, Error, { id: string; soft?: boolean; replaceBroken?: boolean }>({
    mutationFn: ({ id, soft, replaceBroken }) => {
      // K102-broken-repair: deleting a BROKEN entry discards the original
      // text queries.yaml preserves for it, so the server requires an
      // explicit opt-in. A DELETE has no body, so it rides the query
      // string. Omitted entirely for a healthy view, which is unaffected
      // either way.
      const params = new URLSearchParams();
      if (soft === true) params.set("soft", "true");
      if (replaceBroken === true) params.set("replaceBroken", "true");
      const qs = params.toString();
      return apiClient.delete(
        `/api/views/${encodeURIComponent(id)}${qs === "" ? "" : `?${qs}`}`,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
