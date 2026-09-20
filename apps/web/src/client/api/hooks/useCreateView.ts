import type { BuilderTree, CreateViewRequest, SavedQuery } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Create-view request body, extended (Stage 2) with structured
 * `conditions`. The contracts `CreateViewRequest` is frozen at
 * `{name,query,sort}`, and the server accepts either `conditions` OR
 * `query` (core derives the other), so the web sends `conditions` while
 * making `query` optional. The server-side schema mirror is
 * `CreateViewRequestWithConditions` in server.ts.
 */
export type CreateViewBody =
  & Omit<CreateViewRequest, "query">
  & { readonly query?: string; readonly conditions?: BuilderTree };

/**
 * Creates a saved view via `POST /api/views`. On success the views
 * query is invalidated so the sidebar's "Saved filters" group picks up
 * the new entry without a reload.
 */
export function useCreateView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateViewBody) => apiClient.post<SavedQuery>("/api/views", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["views"] });
    },
  });
}
