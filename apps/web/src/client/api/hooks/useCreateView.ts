import type { CreateViewRequest, SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Creates a saved view via `POST /api/views`. On success the views
 * query is invalidated so the sidebar's "Saved filters" group picks up
 * the new entry without a reload.
 */
export function useCreateView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateViewRequest) => apiClient.post<SavedQuery>("/api/views", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
